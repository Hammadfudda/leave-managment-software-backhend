import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import Grade from '../models/Grade.js';
import LeavePolicy from '../models/LeavePolicy.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ValidationError, ConflictError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { initializeLeaveBalances } from '../services/balance.service.js';
import { sendEmail, templates } from '../services/email.service.js';

const tempPassword = () => crypto.randomBytes(18).toString('base64url');

function orgId(req) {
  if (!req.currentUser?.organizationId) {
    throw new ValidationError('Your account is not assigned to an organization.');
  }
  return req.currentUser.organizationId;
}

function csvRows(file) {
  if (!file) throw new ValidationError('A .csv file is required.');
  return parse(file.buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

function normalize(row) {
  const role = String(row.portalRole || row.role || 'employee').trim().toLowerCase();
  return {
    fullName: String(row.fullName || '').trim(),
    email: String(row.email || '').trim().toLowerCase(),
    cnic: String(row.cnic || '').trim(),
    employeeId: String(row.employeeId || '').trim(),
    designation: String(row.designation || '').trim(),
    department: String(row.department || '').trim(),
    grade: String(row.grade || '').trim(),
    managerReference: String(row.managerEmail || row.manager || '').trim(),
    sheetRole: role,
    portalAccess: role === 'manager' ? 'manager' : role === 'employee' ? 'employee' : 'none',
    division: String(row.division || '').trim(),
    dateOfJoining: String(row.dateOfJoining || '').trim(),
    canApproveOtherDepartments: String(row.canApproveOtherDepartments || '').toLowerCase() === 'true',
  };
}

async function buildPreview(req) {
  const organizationId = orgId(req);
  const rows = csvRows(req.file);
  const existing = await User.find({ organizationId, status: { $ne: 'pending_deletion' } })
    .select('fullName email employeeId designation department role')
    .lean();
  const existingByEmail = new Map(existing.map((u) => [String(u.email).toLowerCase(), u]));
  const existingByEmployeeId = new Map(existing.map((u) => [String(u.employeeId).toLowerCase(), u]));

  const [departments, designations, grades, managers] = await Promise.all([
    Department.find({ $or: [{ organizationId }, { organizationId: null }] }).select('name divisionName').lean(),
    Designation.find({ $or: [{ organizationId }, { organizationId: null }] }).select('name').lean(),
    Grade.find({ $or: [{ organizationId }, { organizationId: null }] }).select('name').lean(),
    User.find({ organizationId, role: 'manager', status: 'active' }).select('fullName email department').lean(),
  ]);

  const departmentNames = new Set(departments.map((x) => x.name.toLowerCase()));
  const designationNames = new Set(designations.map((x) => x.name.toLowerCase()));
  const gradeNames = new Set(grades.map((x) => x.name.toLowerCase()));
  const seen = new Set();
  const missingDepartments = new Set();
  const missingDesignations = new Set();
  const missingGrades = new Set();
  const out = [];

  rows.forEach((raw, index) => {
    const row = normalize(raw);
    const errors = [];
    const key = row.email || row.employeeId || String(index);
    if (seen.has(key)) errors.push('Duplicate row in this CSV.');
    seen.add(key);
    if (!row.fullName) errors.push('Full name is required.');
    if (!row.email) errors.push('Email is required.');
    if (!row.employeeId) errors.push('Employee ID is required.');
    if (!row.designation) errors.push('Designation is required.');
    if (!row.department) errors.push('Department is required.');
    if (!row.grade) errors.push('Grade is required.');
    if (!row.cnic) errors.push('CNIC is required.');
    if (!row.dateOfJoining || Number.isNaN(new Date(row.dateOfJoining).getTime())) errors.push('A valid date of joining is required.');
    if (!['employee', 'manager'].includes(row.sheetRole)) errors.push('portalRole must be employee or manager.');

    const duplicate = existingByEmail.get(row.email) || existingByEmployeeId.get(row.employeeId.toLowerCase());
    if (duplicate) errors.push('An employee with this email or employee ID already exists.');

    if (row.department && !departmentNames.has(row.department.toLowerCase())) missingDepartments.add(row.department);
    if (row.designation && !designationNames.has(row.designation.toLowerCase())) missingDesignations.add(row.designation);
    if (row.grade && !gradeNames.has(row.grade.toLowerCase())) missingGrades.add(row.grade);

    out.push({
      rowNumber: index + 2,
      fullName: row.fullName,
      email: row.email,
      employeeId: row.employeeId,
      designation: row.designation,
      department: row.department,
      grade: row.grade,
      managerReference: row.managerReference,
      sheetRole: row.sheetRole,
      portalAccess: row.portalAccess,
      exists: Boolean(duplicate),
      errors,
    });
  });

  const policyMap = new Map();
  for (const raw of rows) {
    const row = normalize(raw);
    const gradeQuota = {
      gradeName: row.grade,
      yearlyQuota: Number(raw.annualQuota || 0),
    };
    for (const type of [
      ['annual', raw.annualQuota, raw.annualPaid],
      ['sick', raw.sickQuota, raw.sickPaid],
      ['casual', raw.casualQuota, raw.casualPaid],
    ]) {
      if (!type[1]) continue;
      const key = type[0];
      if (!policyMap.has(key)) policyMap.set(key, { leaveType: key, isPaid: String(type[2] || 'Paid').toLowerCase() !== 'unpaid', gradeQuotas: [] });
      if (gradeQuota.gradeName) policyMap.get(key).gradeQuotas.push({ gradeName: gradeQuota.gradeName, yearlyQuota: Number(type[1]) });
    }
  }

  return {
    rows: out,
    missingDepartments: [...missingDepartments],
    missingDesignations: [...missingDesignations],
    missingGrades: [...missingGrades],
    existingManagers: managers.map((m) => ({ id: String(m._id), fullName: m.fullName, email: m.email, department: m.department })),
    policySuggestions: [...policyMap.values()].map((p) => ({
      ...p,
      gradeQuotas: p.gradeQuotas.filter((x, i, a) => a.findIndex((y) => y.gradeName.toLowerCase() === x.gradeName.toLowerCase()) === i),
    })),
  };
}

export const preview = asyncHandler(async (req, res) => {
  const previewData = await buildPreview(req);
  res.json({ success: true, preview: previewData });
});

export const metadataPreview = asyncHandler(async (req, res) => {
  const organizationId = orgId(req);
  const rows = csvRows(req.file);
  const departments = await Department.find({ $or: [{ organizationId }, { organizationId: null }] }).select('name divisionName').lean();
  const knownDivisions = new Set(departments.map((d) => String(d.divisionName || '').trim().toLowerCase()).filter(Boolean));
  const missingDivisions = new Set();
  const errors = [];
  const usedLeaveTypes = new Set();

  rows.forEach((raw, index) => {
    const row = normalize(raw);
    if (row.division && !knownDivisions.has(row.division.toLowerCase())) missingDivisions.add(row.division);
    for (const [type, quota, used, paid] of [
      ['annual', raw.annualQuota, raw.annualUsed, raw.annualPaid],
      ['sick', raw.sickQuota, raw.sickUsed, raw.sickPaid],
      ['casual', raw.casualQuota, raw.casualUsed, raw.casualPaid],
    ]) {
      if (quota || used || paid) usedLeaveTypes.add(type);
      const usedNumber = Number(used || 0);
      if (used && (!Number.isFinite(usedNumber) || usedNumber < 0)) {
        errors.push({ rowNumber: index + 2, message: `${type}Used must be a non-negative number.` });
      }
      const quotaNumber = Number(quota || 0);
      if (used && quota && usedNumber > quotaNumber) {
        errors.push({ rowNumber: index + 2, message: `${type}Used cannot exceed ${type}Quota.` });
      }
    }
  });

  res.json({
    success: true,
    preview: {
      missingDivisions: [...missingDivisions],
      missingRoles: [],
      usedLeaveTypes: [...usedLeaveTypes],
      errors,
    },
  });
});

export const commit = asyncHandler(async (req, res) => {
  const organizationId = orgId(req);
  const rows = csvRows(req.file);
  let decisions = {};
  try { decisions = JSON.parse(String(req.body.decisions || '{}')); } catch { throw new ValidationError('Invalid import decisions.'); }
  const permissions = decisions.permissions || {};
  const rowDecisions = new Map((decisions.rows || []).map((r) => [Number(r.rowNumber), r.portalAccess]));

  const created = [];
  const skipped = [];
  const autoCreated = { departments: [], designations: [], grades: [] };

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    const rowNumber = index + 2;
    const row = normalize(raw);
    const role = rowDecisions.get(rowNumber) || row.portalAccess;
    if (!['employee', 'manager'].includes(role)) { skipped.push({ rowNumber, reason: 'Invalid portal access.' }); continue; }

    const duplicate = await User.findOne({ $or: [{ email: row.email }, { employeeId: row.employeeId }, ...(row.cnic ? [{ cnic: row.cnic }, { nationalId: row.cnic }] : [])] });
    if (duplicate) { skipped.push({ rowNumber, reason: 'Duplicate email, employee ID or CNIC.' }); continue; }

    let department = await Department.findOne({ name: row.department, $or: [{ organizationId }, { organizationId: null }] });
    if (!department) {
      if (!permissions.autoCreateDepartments) { skipped.push({ rowNumber, reason: `Missing department: ${row.department}` }); continue; }
      department = await Department.create({ name: row.department, organizationId, divisionName: row.division });
      autoCreated.departments.push(row.department);
    } else if (row.division && !department.divisionName) {
      department.divisionName = row.division;
      await department.save();
    }

    let designation = await Designation.findOne({ name: row.designation, $or: [{ organizationId }, { organizationId: null }] });
    if (!designation) {
      if (!permissions.autoCreateDesignations) { skipped.push({ rowNumber, reason: `Missing designation: ${row.designation}` }); continue; }
      designation = await Designation.create({ name: row.designation, organizationId });
      autoCreated.designations.push(row.designation);
    }

    let grade = await Grade.findOne({ name: row.grade, $or: [{ organizationId }, { organizationId: null }] });
    if (!grade) {
      if (!permissions.autoCreateGrades) { skipped.push({ rowNumber, reason: `Missing grade: ${row.grade}` }); continue; }
      grade = await Grade.create({ name: row.grade, organizationId, annualLeaveQuota: Number(raw.annualQuota || 14), sickLeaveQuota: Number(raw.sickQuota || 7), casualLeaveQuota: Number(raw.casualQuota || 5) });
      autoCreated.grades.push(row.grade);
    }

    const temporaryPassword = tempPassword();
    const user = await User.create({
      organizationId,
      fullName: row.fullName,
      email: row.email,
      nationalId: row.cnic,
      cnic: row.cnic,
      passwordHash: await bcrypt.hash(temporaryPassword, 10),
      passwordChangedFromDefault: false,
      mustChangePassword: true,
      role,
      roleLabel: row.division,
      gradeId: grade._id,
      employeeId: row.employeeId,
      designation: designation.name,
      department: department.name,
      dateOfJoining: new Date(row.dateOfJoining),
      canApproveOtherDepartments: role === 'manager' && row.canApproveOtherDepartments,
    });

    await initializeLeaveBalances(user._id, grade);

    for (const type of ['annual', 'sick', 'casual']) {
      const used = Number(raw[`${type}Used`] || 0);
      if (used > 0) {
        const { default: LeaveBalance } = await import('../models/LeaveBalance.js');
        await LeaveBalance.updateOne({ employeeId: user._id, leaveType: type, year: new Date().getFullYear() }, { $set: { used } });
      }
    }

    if (permissions.createLeavePolicies) {
      for (const type of ['annual', 'sick', 'casual']) {
        const quota = Number(raw[`${type}Quota`] || 0);
        if (!quota) continue;
        await LeavePolicy.findOneAndUpdate(
          { organizationId, leaveType: type, 'approvalRouting.grade': grade.name },
          { $setOnInsert: { applicableRole: 'All Employees', isPaid: String(raw[`${type}Paid`] || 'Paid').toLowerCase() !== 'unpaid', approvalRouting: { grade: grade.name, approverIds: [] } } },
          { upsert: true, new: true }
        );
      }
    }

    created.push(user);
  }

  if (permissions.applyManagerAssignments) {
    const allManagers = await User.find({ organizationId, role: 'manager', status: 'active' }).select('_id email fullName');
    for (const raw of rows) {
      const row = normalize(raw);
      if (!row.managerReference) continue;
      const employee = await User.findOne({ organizationId, email: row.email });
      if (!employee) continue;
      const manager = allManagers.find((m) => String(m.email).toLowerCase() === row.managerReference.toLowerCase() || String(m.fullName).toLowerCase() === row.managerReference.toLowerCase());
      if (manager && String(manager._id) !== String(employee._id)) {
        employee.managerId = manager._id;
        await employee.save();
      }
    }
  }

  for (const user of created) {
    try {
      await sendEmail({ to: user.email, subject: 'Your Leave Management account is ready', html: templates.accountCreated(user, 'temporary password sent securely') });
    } catch {}
  }

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'SMART_IMPORT_EMPLOYEES',
    targetType: 'BulkImport',
    details: `Created ${created.length} employee(s); skipped ${skipped.length}.`,
  });

  res.json({ success: true, created: created.length, skipped, autoCreated, message: `${created.length} employee(s) imported successfully.` });
});

export const metadataCommit = asyncHandler(async (req, res) => {
  const organizationId = orgId(req);
  let decisions = {};
  try { decisions = JSON.parse(String(req.body.decisions || '{}')); } catch { throw new ValidationError('Invalid metadata decisions.'); }
  const emails = Array.isArray(decisions.targetEmails) ? decisions.targetEmails.map((e) => String(e).toLowerCase()) : [];
  if (!emails.length) return res.json({ success: true, updated: 0 });

  const rows = csvRows(req.file);
  const divisions = new Map(rows.map((raw) => [String(raw.email || '').trim().toLowerCase(), String(raw.division || '').trim()]).filter(([email]) => email));
  let updated = 0;

  for (const email of emails) {
    const user = await User.findOne({ organizationId, email });
    if (!user) continue;
    const division = divisions.get(email);
    if (division) {
      user.roleLabel = division;
      await user.save();
      const department = await Department.findOne({ organizationId, name: user.department });
      if (department && !department.divisionName && decisions.autoCreateDivisions) {
        department.divisionName = division;
        await department.save();
      }
    }
    updated += 1;
  }

  res.json({ success: true, updated });
});

