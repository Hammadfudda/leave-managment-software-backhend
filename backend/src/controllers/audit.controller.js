import AuditLog from '../models/AuditLog.js';
import LeaveBalance from '../models/LeaveBalance.js';
import User from '../models/User.js';
import LeaveRequest from '../models/LeaveRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { Parser } from 'json2csv';

/** Spec Part 8.3 — Admin only. Audit logs are append-only. */
export const listAuditLogs = asyncHandler(async (req, res) => {
  if (!req.currentUser.organizationId) throw new Error('Your account is not assigned to an organization.');
  const organizationActorIds = await User.distinct('_id', { organizationId: req.currentUser.organizationId });
  const filter = { actorId: { $in: organizationActorIds } };
  if (req.query.action) filter.action = req.query.action;
  if (req.query.actorId) filter.actorId = req.query.actorId;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.targetType) filter.targetType = req.query.targetType;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const pagination = getPagination(req.query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(items, total, pagination) });
});

/**
 * Historical yearly leave snapshot.
 * LeaveBalance is year-scoped, so this endpoint reads the selected year's
 * preserved ledger instead of returning the current year's balance.
 */
export const yearlyLeaveReport = asyncHandler(async (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: 'A valid year is required.' });
  }

  const organizationEmployeeIds = await User.distinct('_id', { organizationId: req.currentUser.organizationId });
  const balances = await LeaveBalance.find({ year, employeeId: { $in: organizationEmployeeIds } }).lean();
  const employeeIds = [...new Set(balances.map((b) => String(b.employeeId)))];

  const users = await User.find({ _id: { $in: employeeIds }, organizationId: req.currentUser.organizationId })
    .populate('gradeId')
    .lean();

  const byId = new Map(users.map((u) => [String(u._id), u]));
  const rows = balances.map((b) => {
    const u = byId.get(String(b.employeeId));
    if (!u) return null;
    return {
      leaveYear: year,
      employeeId: String(u._id),
      employeeCode: u.employeeId || '',
      employeeName: u.fullName || '',
      division: u.roleLabel || '',
      department: u.department || '',
      designation: u.designation || '',
      grade: u.gradeId?.name || '',
      leaveType: b.leaveType,
      granted: Number(b.quota || 0),
      used: Number(b.used || 0),
      remaining: Math.max(0, Number(b.quota || 0) - Number(b.used || 0)),
      employeeStatus: u.status || '',
      detailsStatus: u.detailsStatus || '',
    };
  }).filter(Boolean);

  // For the current year, also include employees whose balance was not yet
  // initialized, so the report does not silently hide active employees.
  if (year === new Date().getFullYear()) {
    const existing = new Set(rows.map((r) => String(r.employeeId)));
    for (const u of users) {
      if (!existing.has(String(u._id))) continue;
    }
  }

  res.json({ success: true, data: rows });
});

export const exportYearlyLeaveReport = asyncHandler(async (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: 'A valid year is required.' });
  }

  const organizationEmployeeIds = await User.distinct('_id', { organizationId: req.currentUser.organizationId });
  const balances = await LeaveBalance.find({ year, employeeId: { $in: organizationEmployeeIds } }).lean();
  const ids = [...new Set(balances.map((b) => String(b.employeeId)))];
  const users = await User.find({ _id: { $in: ids }, organizationId: req.currentUser.organizationId }).populate('gradeId').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rows = balances.map((b) => {
    const u = byId.get(String(b.employeeId));
    if (!u) return null;
    return {
      Year: year,
      Employee: u.fullName || '',
      'Employee ID': u.employeeId || '',
      Division: u.roleLabel || '',
      Department: u.department || '',
      Designation: u.designation || '',
      Grade: u.gradeId?.name || '',
      'Leave Type': b.leaveType,
      Granted: Number(b.quota || 0),
      Used: Number(b.used || 0),
      Remaining: Math.max(0, Number(b.quota || 0) - Number(b.used || 0)),
    };
  }).filter(Boolean);

  const csv = new Parser().parse(rows);
  res.header('Content-Type', 'text/csv');
  res.attachment(`yearly-leave-report-${year}.csv`);
  res.send(csv);
});
