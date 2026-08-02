import bcrypt from 'bcryptjs';
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
import { emailAdmins } from '../services/notification.service.js';

const RESTORE_WINDOW_DAYS = 7;

/** Spec Part 10.3 — role-scoping is applied BEFORE query filters, always. */
function buildEmployeeFilter(query, currentUser) {
  const filter = {};

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
  const user = await User.findById(req.params.id).populate('gradeId');
  if (!user) throw new NotFoundError();

  // An employee may only read their own record.
  if (req.currentUser.role === 'employee' && String(user._id) !== String(req.currentUser._id)) {
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

  const duplicate = await User.findOne({
    $or: [
      { email: String(body.email).toLowerCase() },
      { nationalId: body.cnic },
      { employeeId: body.employeeId },
    ],
  });
  if (duplicate) throw new ConflictError('An employee with that email, CNIC or ID already exists.');

  const grade = await Grade.findById(body.gradeId);
  if (!grade) throw new ValidationError('Unknown grade.');

  const user = await User.create({
    fullName: body.fullName,
    email: String(body.email).toLowerCase(),
    nationalId: body.cnic,
    cnic: body.cnic,
    passwordHash: await bcrypt.hash(body.cnic, 10), // CNIC as default password
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
    html: templates.accountCreated(user),
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

export const updateEmployee = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
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
      // Removal/restore go through their own endpoints so the 7-day window and
      // token revocation can't be bypassed by a plain PATCH.
      if (req.body.status === 'pending_deletion') continue;
      user.status = req.body.status;
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
 * immediately) and pending leave requests are auto-cancelled. The User document
 * is hard-deleted by the nightly job once the 7-day window expires; the
 * LeaveRequest history is kept.
 */
export const removeEmployee = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
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

export const restoreEmployee = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new NotFoundError();
  if (user.status !== 'pending_deletion') {
    throw new ValidationError('This employee is not pending deletion.');
  }

  user.status = 'active'; // same credentials work immediately
  user.deactivatedAt = null;
  user.scheduledPurgeAt = null;
  user.removedBy = null;
  await user.save();

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'RESTORE_EMPLOYEE',
    targetType: 'User',
    targetId: user._id,
    affectedPerson: user.fullName,
    department: user.department,
    details: `Restored ${user.fullName} within the ${RESTORE_WINDOW_DAYS}-day window`,
  });

  await emailAdmins(
    'Employee restored',
    `${user.fullName} (${user.employeeId}) was restored by ${req.currentUser.fullName}.`
  );

  res.json({ success: true, data: sanitizeUser(user) });
});

export const listRemovedEmployees = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { status: 'pending_deletion' };

  const [users, total] = await Promise.all([
    User.find(filter).populate('gradeId').sort({ scheduledPurgeAt: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  const now = Date.now();
  const data = users.map((u) => {
    const msRemaining = u.scheduledPurgeAt ? u.scheduledPurgeAt.getTime() - now : 0;
    return {
      ...sanitizeUser(u),
      timeRemaining: {
        msRemaining: Math.max(0, msRemaining),
        daysRemaining: Math.max(0, Math.ceil(msRemaining / 86400000)),
        purgesAt: u.scheduledPurgeAt,
      },
    };
  });

  res.json({ success: true, ...paginated(data, total, { page, limit }) });
});

/** Spec Part 10.1 — export includes leave balances, not just profile fields. */
export const exportEmployeesCsv = asyncHandler(async (req, res) => {
  const users = await User.find({}).populate('gradeId');
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
        dateOfJoining: u.dateOfJoining.toISOString().split('T')[0],
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

/**
 * Spec Part 10.2 — import auto-creates Department, Designation and Grade if
 * they don't exist yet. Admin drops in a CSV with department: "Logistics" even
 * if Logistics has never been added, and it just works.
 */
export const importEmployeesCsv = asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('A .csv file is required.');

  const rows = parse(req.file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const results = {
    created: 0,
    skipped: [],
    autoCreated: { departments: [], designations: [], grades: [] },
  };

  for (const row of rows) {
    if (!row.email || !row.cnic || !row.fullName) {
      results.skipped.push({ row, reason: 'Missing fullName, email or cnic' });
      continue;
    }

    const exists = await User.findOne({
      $or: [{ email: String(row.email).toLowerCase() }, { nationalId: row.cnic }],
    });
    if (exists) {
      results.skipped.push({ row, reason: 'Duplicate email or CNIC' });
      continue;
    }

    // --- Auto-create related records instead of rejecting the row ---
    let department = await Department.findOne({ name: row.department });
    if (!department) {
      department = await Department.create({ name: row.department, saturdayOff: true });
      results.autoCreated.departments.push(row.department);
    }

    let designation = await Designation.findOne({ name: row.designation });
    if (!designation) {
      designation = await Designation.create({ name: row.designation });
      results.autoCreated.designations.push(row.designation);
    }

    let grade = await Grade.findOne({ name: row.grade });
    if (!grade) {
      // A brand-new grade needs *some* quota so new hires aren't stuck at zero —
      // default to the company baseline and let Admin adjust it afterward in the
      // Grades screen. Do not silently default to 0; that creates a support
      // ticket for every CSV-imported employee whose grade was new.
      grade = await Grade.create({
        name: row.grade,
        annualLeaveQuota: 14,
        sickLeaveQuota: 7,
        casualLeaveQuota: 5,
      });
      results.autoCreated.grades.push(row.grade);
    }

    const newUser = await User.create({
      fullName: row.fullName,
      email: String(row.email).toLowerCase(),
      nationalId: row.cnic,
      cnic: row.cnic,
      passwordHash: await bcrypt.hash(row.cnic, 10),
      role: row.role || 'employee',
      designation: designation.name,
      department: department.name,
      gradeId: grade._id,
      employeeId: row.employeeId,
      dateOfJoining: new Date(row.dateOfJoining),
      canApproveOtherDepartments: false, // safe default — Admin enables per manager
    });

    await initializeLeaveBalances(newUser._id, grade);
    results.created++;
  }

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'IMPORT_EMPLOYEES',
    targetType: 'BulkImport',
    details: `Imported ${results.created} employees. Auto-created: ${results.autoCreated.departments.length} department(s), ${results.autoCreated.designations.length} designation(s), ${results.autoCreated.grades.length} grade(s).`,
  });

  res.json({ success: true, ...results });
});
