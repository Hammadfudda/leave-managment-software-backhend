import { Parser } from 'json2csv';
import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Spec Part 10 — reporting. Role scoping is applied BEFORE the query filters,
 * exactly as on every other list endpoint, so a manager can never widen their
 * view by hand-crafting query params.
 */
function scopeFor(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'manager') {
    return { $or: [{ employeeId: user._id }, { requiredApproverIds: user._id }] };
  }
  return { employeeId: user._id };
}

function applyFilters(filter, query) {
  if (query.status) filter.status = query.status;
  if (query.leaveType) filter.leaveType = query.leaveType;
  if (query.department) filter.department = query.department;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.employeeName) {
    filter.employeeName = { $regex: String(query.employeeName).trim(), $options: 'i' };
  }
  if (query.from || query.to) {
    filter.startDate = {};
    if (query.from) filter.startDate.$gte = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      to.setHours(23, 59, 59, 999);
      filter.startDate.$lte = to;
    }
  }
  return filter;
}

export const summary = asyncHandler(async (req, res) => {
  const filter = applyFilters({ ...scopeFor(req.currentUser) }, req.query);
  const requests = await LeaveRequest.find(filter);

  const byStatus = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  const byLeaveType = {};
  const byDepartment = {};
  let totalWorkingDaysApproved = 0;

  for (const r of requests) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byLeaveType[r.leaveType] = (byLeaveType[r.leaveType] || 0) + 1;
    if (r.department) byDepartment[r.department] = (byDepartment[r.department] || 0) + 1;
    if (r.status === 'approved') totalWorkingDaysApproved += r.totalWorkingDays || 0;
  }

  const employeeFilter =
    req.currentUser.role === 'admin'
      ? { status: 'active' }
      : req.currentUser.role === 'manager'
        ? { status: 'active', department: req.currentUser.department }
        : { _id: req.currentUser._id };

  res.json({
    success: true,
    data: {
      totalRequests: requests.length,
      byStatus,
      byLeaveType,
      byDepartment,
      totalWorkingDaysApproved,
      extensions: requests.filter((r) => r.isExtension).length,
      stopRequests: requests.filter((r) => r.isStopRequest).length,
      activeEmployees: await User.countDocuments(employeeFilter),
      pendingDeletion:
        req.currentUser.role === 'admin'
          ? await User.countDocuments({ status: 'pending_deletion' })
          : undefined,
    },
  });
});

export const exportRequestsCsv = asyncHandler(async (req, res) => {
  const filter = applyFilters({ ...scopeFor(req.currentUser) }, req.query);
  const requests = await LeaveRequest.find(filter).sort({ createdAt: -1 });

  const rows = requests.map((r) => ({
    employeeName: r.employeeName,
    department: r.department,
    leaveType: r.leaveType,
    startDate: new Date(r.startDate).toISOString().split('T')[0],
    endDate: new Date(r.actualEndDate || r.endDate).toISOString().split('T')[0],
    calendarDays: r.totalDaysRequested,
    workingDays: r.totalWorkingDays,
    status: r.status,
    type: r.isExtension ? 'extension' : r.isStopRequest ? 'stop-request' : 'leave',
    reason: r.reason,
    approvals: r.approvalHistory
      .map((h) => `${h.approverName}: ${h.action}${h.comment ? ` (${h.comment})` : ''}`)
      .join(' | '),
    submittedOn: new Date(r.createdAt).toISOString().split('T')[0],
  }));

  // json2csv throws on an empty array without explicit fields, so give it a
  // header-only file rather than a 500 when a filter matches nothing.
  const parser = new Parser({
    fields: [
      'employeeName',
      'department',
      'leaveType',
      'startDate',
      'endDate',
      'calendarDays',
      'workingDays',
      'status',
      'type',
      'reason',
      'approvals',
      'submittedOn',
    ],
  });
  const csv = parser.parse(rows);

  res.header('Content-Type', 'text/csv');
  res.attachment(`leave-requests-${Date.now()}.csv`);
  res.send(csv);
});
