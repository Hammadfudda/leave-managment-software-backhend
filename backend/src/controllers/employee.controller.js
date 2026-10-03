import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { Parser } from 'json2csv';
import User from '../models/User.js';
import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import LeaveRequest from '../models/LeaveRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sanitizeUser } from '../utils/tokens.js';
import { audit } from '../utils/audit.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import {
  initializeLeaveBalances,
  syncQuotasToGrade,
  getLeaveBalancesForUser,
  CORE_LEAVE_TYPES,
} from '../services/balance.service.js';
import { sendEmail, templates } from '../services/email.service.js';
import { RESTORE_WINDOW_DAYS } from '../services/deletion.service.js';
import { emailAdmins } from '../services/notification.service.js';
import { generateTemporaryPassword as generateResetTemporaryPassword, sendTemporaryAccountEmail } from '../services/temporaryPassword.service.js';

function generateTemporaryPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function requireOrganizationId(currentUser) {
  if (!currentUser?.organizationId) {
    throw new ValidationError('Your account is not assigned to an organization.');
  }
  return currentUser.organizationId;
}

/** Spec Part 10.3 — role-scoping is applied BEFORE query filters, always. */
function buildEmployeeFilter(query, currentUser) {
  const filter = { organizationId: requireOrganizationId(currentUser) };

  // Role scoping first.
  if (currentUser.role === 'manager') {
    filter.$or = [{ managerId: currentUser._id }, { department: currentUser.department }];
  } else if (currentUser.role === 'employee') {
    filter._id = currentUser._id;
  }

  // Then the optional query filters. Every one of them is optional.
  if (query.department) filter.department = query.department;
  if (query.designation) filter.designation = query.designation;
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  else filter.status = { $ne: 'pending_deletion' };
  if (query.grade) filter.gradeId = query.grade;
  if (query.search || query.employeeName) {
    const term = query.search || query.employeeName;
    filter.fullName = { $regex: term, $options: 'i' };
  }
  return filter;
}

export const listEmployees = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = buildEmployeeFilter(req.query, req.currentUser);

  const [users, total] = await Promise.all([
    User.find(filter).populate('gradeId').sort({ fullName: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(users.map(sanitizeUser), total, { page, limit }) });
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).populate('gradeId');
  if (!user) throw new NotFoundError();
  const balances = await getLeaveBalancesForUser(user._id);
  res.json({ success: true, data: { ...sanitizeUser(user), balances } });
});

export const getEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({ _id: req.params.id, organizationId }).populate('gradeId');
  if (!user) throw new NotFoundError();

  // Employees may only read themselves. Managers may only read employees
  // in their assigned team/department, matching the existing list scope.
  if (req.currentUser.role === 'employee' && String(user._id) !== String(req.currentUser._id)) {
    throw new NotFoundError();
  }
  if (
    req.currentUser.role === 'manager' &&
    String(user.managerId || '') !== String(req.currentUser._id) &&
    user.department !== req.currentUser.department
  ) {
    throw new NotFoundError();
  }
  const balances = await getLeaveBalancesForUser(user._id);
  res.json({ success: true, data: { ...sanitizeUser(user), balances } });
});

export const createEmployee = asyncHandler(async (req, res) => {
  const body = req.body;
  const required = [
    'fullName',
    'email',
    'cnic',
    'role',
    'gradeId',
    'employeeId',
    'designation',
    'department',
    'dateOfJoining',
  ];
  const missing = required.filter((f) => !body[f]);
  if (missing.length) {
    throw new ValidationError(
      'Missing required fields.',
      Object.fromEntries(missing.map((f) => [f, 'Required']))
    );
  }

  const organizationId = requireOrganizationId(req.currentUser);
  const duplicate = await User.findOne({
    organizationId,
    $or: [
      { email: String(body.email).toLowerCase() },
      { nationalId: body.cnic },
      { employeeId: body.employeeId },
    ],
  });
  if (duplicate) throw new ConflictError('An employee with that email, CNIC or ID already exists.');

  const grade = await Grade.findOne({
    _id: body.gradeId,
    $or: [{ organizationId }, { organizationId: null }],
  });
  if (!grade) throw new ValidationError('Unknown grade.');

  const temporaryPassword = generateTemporaryPassword();

  const user = await User.create({
    organizationId,
    fullName: body.fullName,
    email: String(body.email).toLowerCase(),
    nationalId: body.cnic,
    cnic: body.cnic,
    passwordHash: await bcrypt.hash(temporaryPassword, 10),
    passwordChangedFromDefault: false,
    mustChangePassword: true,
    role: body.role,
    gradeId: grade._id,
    managerId: body.managerId || null,
    canApproveOtherDepartments:
      body.role === 'manager' ? Boolean(body.canApproveOtherDepartments) : false,
    employeeId: body.employeeId,
    designation: body.designation,
    department: body.department,
    phone: body.phone,
    dateOfJoining: new Date(body.dateOfJoining),
    profilePhotoUrl: body.profilePhotoUrl,
  });

  await initializeLeaveBalances(user._id, grade);

  await sendEmail({
    to: user.email,
    subject: 'Your Leave Management account is ready',
    html: templates.accountCreated(user, temporaryPassword),
  });

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'CREATE_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: `Created employee ${user.fullName} (${user.employeeId})`,
  });

  res.status(201).json({ success: true, data: sanitizeUser(user) });
});

export const resetEmployeePassword = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({
    _id: req.params.id,
    organizationId,
    role: { $in: ['manager', 'employee'] },
  });

  if (!user) throw new NotFoundError('Employee or Manager not found.');

  const temporaryPassword = generateResetTemporaryPassword();
  const previous = {
    passwordHash: user.passwordHash,
    passwordChangedAt: user.passwordChangedAt,
    passwordChangedFromDefault: user.passwordChangedFromDefault,
    mustChangePassword: user.mustChangePassword,
    refreshTokenHash: user.refreshTokenHash,
  };

  user.passwordHash = await bcrypt.hash(temporaryPassword, 12);
  user.passwordChangedFromDefault = false;
  user.passwordChangedAt = new Date();
  user.mustChangePassword = true;
  user.refreshTokenHash = null;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  const emailSent = await sendTemporaryAccountEmail({
    to: user.email,
    fullName: user.fullName,
    roleLabel: user.role === 'manager' ? 'Manager' : 'Employee',
    temporaryPassword,
  });

  if (!emailSent) {
    user.passwordHash = previous.passwordHash;
    user.passwordChangedAt = previous.passwordChangedAt;
    user.passwordChangedFromDefault = previous.passwordChangedFromDefault;
    user.mustChangePassword = previous.mustChangePassword;
    user.refreshTokenHash = previous.refreshTokenHash;
    await user.save();
    throw new ValidationError('Temporary password email could not be sent. The password was left unchanged.');
  }

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'RESET_EMPLOYEE_PASSWORD',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: 'Generated a new temporary password for ' + user.fullName + ' (' + user.employeeId + ').',
  });

  return res.json({
    success: true,
    message: 'A new temporary password was generated and emailed to the user.',
    emailSent: true,
  });
});

export const updateEmployeeRoleLabel = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const roleLabel = String(req.body.roleLabel || '').trim();

  const user = await User.findOne({
    _id: req.params.id,
    organizationId,
    role: { $in: ['employee', 'manager'] },
  });
  if (!user) throw new NotFoundError('Employee or Manager not found.');

  user.roleLabel = roleLabel;
  await user.save();

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'EDIT_EMPLOYEE_DIVISION',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: `Updated Division to "${roleLabel || 'Unassigned'}".`,
  });

  res.json({ success: true, data: sanitizeUser(user) });
});

export const updateEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({ _id: req.params.id, organizationId });
  if (!user) throw new NotFoundError();

  const editable = [
    'fullName',
    'email',
    'role',
    'gradeId',
    'managerId',
    'canApproveOtherDepartments',
    'employeeId',
    'designation',
    'department',
    'phone',
    'dateOfJoining',
    'status',
    'profilePhotoUrl',
  ];
  const changed = [];
  for (const field of editable) {
    if (req.body[field] === undefined) continue;
    if (field === 'email') {
      user.email = String(req.body.email).toLowerCase();
    } else if (field === 'dateOfJoining') {
      user.dateOfJoining = new Date(req.body.dateOfJoining);
    } else if (field === 'status') {
      // Deletion/restore must use their dedicated endpoints so the 10-day
      // window cannot be bypassed by a generic PATCH.
      if (req.body.status === 'pending_deletion') continue;
      if (user.status === 'pending_deletion') {
        throw new ValidationError('Restore the account from Recently Deleted before changing its status.');
      }
      if (!['active', 'inactive'].includes(req.body.status)) {
        throw new ValidationError('Account status must be active or inactive.');
      }
      user.status = req.body.status;
      user.refreshTokenHash = null;
      user.sessionRevokedAt = new Date();
    } else {
      user[field] = req.body[field];
    }
    changed.push(field);
  }
  if (user.role !== 'manager') user.canApproveOtherDepartments = false;

  await user.save();

  if (changed.includes('gradeId')) {
    const grade = await Grade.findById(user.gradeId);
    await syncQuotasToGrade(user._id, grade);
  }

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'EDIT_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: `Updated ${changed.join(', ') || 'nothing'}`,
  });

  res.json({ success: true, data: sanitizeUser(user) });
});

/**
 * Spec Part 4 — soft delete. Refresh tokens are revoked (login blocked
 * immediately) and pending leave requests are auto-cancelled. The User document is hard-deleted by the scheduled purge once the 10-day
 * restore window expires.
 */
export const removeEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({ _id: req.params.id, organizationId });
  if (!user) throw new NotFoundError();
  if (String(user._id) === String(req.currentUser._id)) {
    throw new ValidationError('You cannot remove your own account.');
  }

  const now = new Date();
  user.status = 'pending_deletion';
  user.deactivatedAt = now;
  user.scheduledPurgeAt = new Date(now.getTime() + RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  user.removedBy = req.currentUser._id;
  user.refreshTokenHash = null; // login blocked immediately
  user.sessionRevokedAt = now;
  await user.save();

  const cancelled = await LeaveRequest.updateMany(
    { employeeId: user._id, status: 'pending' },
    {
      $set: { status: 'cancelled', cancelledBy: req.currentUser._id, cancelledByName: req.currentUser.fullName, cancelledReason: 'Employee removed' },
      $push: {
        approvalHistory: {
          approverId: req.currentUser._id,
          approverName: req.currentUser.fullName,
          approverRole: req.currentUser.role,
          action: 'cancelled',
          comment: 'Auto-cancelled: employee removed',
        },
      },
    }
  );

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'REMOVE_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: `Removed ${user.fullName}; ${cancelled.modifiedCount} pending request(s) auto-cancelled. Restorable until ${user.scheduledPurgeAt.toISOString()}`,
  });

  await emailAdmins(
    'Employee removed',
    `${user.fullName} (${user.employeeId}) was removed by ${req.currentUser.fullName}. They can be restored until ${user.scheduledPurgeAt.toDateString()}.`
  );

  res.json({ success: true, data: sanitizeUser(user) });
});

export const suspendEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({ _id: req.params.id, organizationId });
  if (!user) throw new NotFoundError();
  if (String(user._id) === String(req.currentUser._id)) {
    throw new ValidationError('You cannot suspend your own account.');
  }
  if (user.status === 'pending_deletion') {
    throw new ValidationError('Restore the account before changing its suspension status.');
  }
  if (user.status === 'inactive') {
    throw new ValidationError('This account is already suspended.');
  }
  user.status = 'inactive';
  user.refreshTokenHash = null;
  user.sessionRevokedAt = new Date();
  await user.save();
  await audit({
    actorId: req.currentUser._id, actorName: req.currentUser.fullName,
    action: 'SUSPEND_EMPLOYEE', targetType: 'User', targetId: user._id,
    affectedPerson: user.fullName, department: user.department,
    details: `Suspended ${user.fullName}; all active sessions were revoked.`,
  });
  await emailAdmins('Employee suspended',
    `${user.fullName} (${user.employeeId}) was suspended by ${req.currentUser.fullName}.`
  );
  res.json({ success: true, data: sanitizeUser(user) });
});

export const activateEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const user = await User.findOne({ _id: req.params.id, organizationId });
  if (!user) throw new NotFoundError();
  if (user.status === 'pending_deletion') {
    throw new ValidationError('Restore the account from Recently Deleted first.');
  }
  if (user.status === 'active') {
    throw new ValidationError('This account is already active.');
  }
  user.status = 'active';
  user.refreshTokenHash = null;
  user.sessionRevokedAt = new Date();
  await user.save();
  await audit({
    actorId: req.currentUser._id, actorName: req.currentUser.fullName,
    action: 'ACTIVATE_EMPLOYEE', targetType: 'User', targetId: user._id,
    affectedPerson: user.fullName, department: user.department,
    details: `Activated ${user.fullName} and revoked old sessions.`,
  });
  await emailAdmins('Employee activated',
    `${user.fullName} (${user.employeeId}) was activated by ${req.currentUser.fullName}.`
  );
  res.json({ success: true, data: sanitizeUser(user) });
});
export const restoreEmployee = asyncHandler(async (req, res) => {
  const currentUser = req.currentUser;
  const organizationId = requireOrganizationId(currentUser);

  const user = await User.findOne({
    _id: req.params.id,
    organizationId,
    status: 'pending_deletion',
  });

  if (!user) throw new NotFoundError('Removed employee not found.');
  if (user.scheduledPurgeAt && user.scheduledPurgeAt.getTime() <= Date.now()) {
    throw new ValidationError('The 10-day restore window has expired.');
  }

  user.status = 'active';
  user.deactivatedAt = null;
  user.scheduledPurgeAt = null;
  user.removedBy = null;
  user.refreshTokenHash = null;
  user.sessionRevokedAt = new Date();

  await user.save();

  await audit({
    actorId: currentUser._id,
    actorName: currentUser.fullName,
    action: 'RESTORE_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: 'Employee account restored from Recently Deleted.',
  });

  res.json({
    success: true,
    message: 'Employee account restored successfully.',
    data: sanitizeUser(user),
  });
});
/** Spec Part 10.1 — export includes leave balances, not just profile fields. */
export const exportEmployeesCsv = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const users = await User.find({ organizationId }).populate('gradeId');
  const leaveTypes = CORE_LEAVE_TYPES;

  const rows = await Promise.all(
    users.map(async (u) => {
      const balances = await getLeaveBalancesForUser(u._id);
      const row = {
        fullName: u.fullName,
        email: u.email,
        employeeId: u.employeeId,
        cnic: u.cnic,
        role: u.role,
        designation: u.designation,
        department: u.department,
        grade: u.gradeId?.name,
        dateOfJoining: u.dateOfJoining?.toISOString().split('T')[0] || '',
        status: u.status,
        canApproveOtherDepartments: u.role === 'manager' ? u.canApproveOtherDepartments : '',
      };
      for (const type of leaveTypes) {
        const b = balances[type] || { quota: 0, used: 0, remaining: 0 };
        row[`${type}Granted`] = b.quota;
        row[`${type}Used`] = b.used;
        row[`${type}Remaining`] = b.remaining;
      }
      return row;
    })
  );

  const parser = new Parser();
  const csv = parser.parse(rows);
  res.header('Content-Type', 'text/csv');
  res.attachment(`employees-export-${Date.now()}.csv`);
  res.send(csv);
});

export const listRemovedEmployees = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const { page, limit, skip } = getPagination(req.query);
  const filter = { organizationId, status: 'pending_deletion' };

  const [users, total] = await Promise.all([
    User.find(filter).populate('gradeId').sort({ scheduledPurgeAt: 1, fullName: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    ...paginated(users.map(sanitizeUser), total, { page, limit }),
  });
});

export const completePendingEmployee = asyncHandler(async (req, res) => {
  const organizationId = requireOrganizationId(req.currentUser);
  const cnic = String(req.body.cnic || '').trim();

  if (!cnic) throw new ValidationError('CNIC is required.');

  const user = await User.findOne({
    _id: req.params.id,
    organizationId,
    status: { $ne: 'pending_deletion' },
  });

  if (!user) throw new NotFoundError('Pending employee not found.');
  if (user.detailsStatus !== 'pending' && !user.pendingFields?.length) {
    throw new ValidationError('This employee does not have pending details.');
  }

  const duplicate = await User.findOne({
    organizationId,
    _id: { $ne: user._id },
    $or: [{ cnic }, { nationalId: cnic }],
  });
  if (duplicate) throw new ConflictError('That CNIC is already assigned to another employee.');

  user.cnic = cnic;
  user.nationalId = cnic;
  user.detailsStatus = 'complete';
  user.pendingFields = [];
  await user.save();

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'COMPLETE_PENDING_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: 'Completed pending employee identity details.',
  });

  res.json({ success: true, message: 'Employee details completed successfully.', data: sanitizeUser(user) });
});

/**
 * Smart CSV import:
 * - preview never writes to the database;
 * - commit creates valid rows;
 * - rows missing CNIC are created as pending-detail employees so the Admin can
 *   complete them later;
 * - Department, Designation and Grade are auto-created within this organization;
 * - all database queries are organization-scoped.
 */
export const importEmployeesCsv = asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('A .csv file is required.');

  const mode = String(req.query.mode || 'preview').toLowerCase();
  if (!['preview', 'commit'].includes(mode)) {
    throw new ValidationError('Import mode must be preview or commit.');
  }

  const rows = parse(req.file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const organizationId = requireOrganizationId(req.currentUser);
  const blocking = [];
  const pendingEmployees = [];
  const seen = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 2;
    const fullName = String(row.fullName || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const employeeId = String(row.employeeId || '').trim();
    const cnic = String(row.cnic || '').trim();
    const role = String(row.role || 'employee').trim().toLowerCase();
    const designation = String(row.designation || '').trim();
    const department = String(row.department || '').trim();
    const gradeName = String(row.grade || '').trim();
    const dateOfJoining = String(row.dateOfJoining || '').trim();

    const addBlocking = (field, message) =>
      blocking.push({ row: rowNumber, employee: fullName || employeeId || email || `Row ${rowNumber}`, field, message });

    if (!fullName) addBlocking('fullName', 'Full name is required.');
    if (!email) addBlocking('email', 'Email is required.');
    if (!employeeId) addBlocking('employeeId', 'Employee ID is required.');
    if (!designation) addBlocking('designation', 'Designation is required.');
    if (!department) addBlocking('department', 'Department is required.');
    if (!gradeName) addBlocking('grade', 'Grade is required.');
    if (!dateOfJoining || Number.isNaN(new Date(dateOfJoining).getTime())) {
      addBlocking('dateOfJoining', 'A valid date of joining is required.');
    }
    if (!['employee', 'manager'].includes(role)) {
      addBlocking('role', 'Role must be employee or manager.');
    }

    const duplicateKey = `${email}|${employeeId}|${cnic}`;
    if (seen.has(duplicateKey)) addBlocking('duplicate', 'This row duplicates another row in the same CSV.');
    seen.add(duplicateKey);

    const existing = email || employeeId || cnic
      ? await User.findOne({
          organizationId,
          $or: [
            ...(email ? [{ email }] : []),
            ...(employeeId ? [{ employeeId }] : []),
            ...(cnic ? [{ cnic }, { nationalId: cnic }] : []),
          ],
        }).select('_id fullName email employeeId')
      : null;

    if (existing) {
      addBlocking('duplicate', 'An employee with this email, employee ID or CNIC already exists.');
    }

    if (!cnic && fullName && email && employeeId && designation && department && gradeName && dateOfJoining && ['employee', 'manager'].includes(role) && !existing) {
      pendingEmployees.push({
        row: rowNumber,
        fullName,
        employeeId,
        issues: [{ field: 'cnic', message: 'CNIC is missing. The employee can be created now and completed later.' }],
        pendingFields: ['cnic'],
      });
    }
  }

  if (blocking.length) {
    return res.status(400).json({
      success: false,
      message: 'CSV contains blocking errors. Nothing was imported.',
      hardErrors: blocking,
      summary: { total: rows.length, complete: 0, pending: pendingEmployees.length, blocking: blocking.length },
    });
  }

  if (mode === 'preview') {
    return res.json({
      success: true,
      preview: true,
      requiresConfirmation: pendingEmployees.length > 0,
      summary: {
        total: rows.length,
        complete: rows.length - pendingEmployees.length,
        pending: pendingEmployees.length,
        blocking: 0,
      },
      pendingEmployees,
    });
  }

  const results = {
    created: 0,
    skipped: [],
    autoCreated: { departments: [], designations: [], grades: [] },
    pending: 0,
  };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const fullName = String(row.fullName || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const employeeId = String(row.employeeId || '').trim();
    const cnic = String(row.cnic || '').trim();
    const role = String(row.role || 'employee').trim().toLowerCase();
    const designationName = String(row.designation || '').trim();
    const departmentName = String(row.department || '').trim();
    const roleLabel = String(row.roleLabel || row.division || '').trim();
    const gradeName = String(row.grade || '').trim();

    const exists = await User.findOne({
      organizationId,
      $or: [{ email }, { employeeId }, ...(cnic ? [{ cnic }, { nationalId: cnic }] : [])],
    });
    if (exists) {
      results.skipped.push({ row, reason: 'Duplicate email, CNIC or employee ID' });
      continue;
    }

    let department = await Department.findOne({
      name: departmentName,
      $or: [{ organizationId }, { organizationId: null }],
    });
    if (!department) {
      department = await Department.create({ name: departmentName, saturdayOff: true, organizationId });
      results.autoCreated.departments.push(departmentName);
    }

    let designation = await Designation.findOne({
      name: designationName,
      $or: [{ organizationId }, { organizationId: null }],
    });
    if (!designation) {
      designation = await Designation.create({ name: designationName, organizationId });
      results.autoCreated.designations.push(designationName);
    }

    let grade = await Grade.findOne({
      name: gradeName,
      $or: [{ organizationId }, { organizationId: null }],
    });
    if (!grade) {
      grade = await Grade.create({
        name: gradeName,
        organizationId,
        annualLeaveQuota: 14,
        sickLeaveQuota: 7,
        casualLeaveQuota: 5,
      });
      results.autoCreated.grades.push(gradeName);
    }

    const temporaryPassword = generateTemporaryPassword();
    const isPending = !cnic;
    const placeholder = `PENDING-${String(organizationId).slice(-8)}-${Date.now()}-${index}`;

    const newUser = await User.create({
      organizationId,
      fullName,
      email,
      nationalId: cnic || placeholder,
      cnic: cnic || placeholder,
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      passwordChangedFromDefault: false,
      mustChangePassword: true,
      role,
      roleLabel,
      designation: designation.name,
      department: department.name,
      gradeId: grade._id,
      employeeId,
      dateOfJoining: new Date(row.dateOfJoining),
      canApproveOtherDepartments: role === 'manager' ? String(row.canApproveOtherDepartments).toLowerCase() === 'true' : false,
      detailsStatus: isPending ? 'pending' : 'complete',
      pendingFields: isPending ? ['cnic'] : [],
    });

    await initializeLeaveBalances(newUser._id, grade);

    await sendEmail({
      to: newUser.email,
      subject: 'Your Leave Management account is ready',
      html: templates.accountCreated(newUser, temporaryPassword),
    });

    results.created += 1;
    if (isPending) results.pending += 1;
  }

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'IMPORT_EMPLOYEES',
    targetType: 'BulkImport',
    details: `Imported ${results.created} employees. Pending details: ${results.pending}. Auto-created: ${results.autoCreated.departments.length} department(s), ${results.autoCreated.designations.length} designation(s), ${results.autoCreated.grades.length} grade(s).`,
  });

  res.json({
    success: true,
    ...results,
    message: `${results.created} employee(s) imported successfully.${results.pending ? ` ${results.pending} employee(s) need CNIC completion.` : ''}`,
  });
});
