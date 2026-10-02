import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';
import Department from '../models/Department.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getLeaveBalancesForUser } from '../services/balance.service.js';
import { getCurrentTurnApproverIds, isAwaitingAdminDecision } from '../services/approvalChain.js';

/**
 * ADDENDUM 2.3 — role-specific dashboards.
 *
 * Note what the Admin dashboard deliberately does NOT contain: any personal
 * leave widget ("my sick leave balance", "my requests"). Admin does not apply
 * for leave through this system, so those numbers are meaningless noise.
 */

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** ADDENDUM 2.4 — every admin/manager-facing leave row carries the day math. */
function leaveRow(r) {
  return {
    id: r._id,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    department: r.department,
    leaveType: r.leaveType,
    startDate: r.startDate,
    endDate: r.endDate,
    actualEndDate: r.actualEndDate || null,
    status: r.status,
    totalDaysRequested: r.totalDaysRequested,
    totalWorkingDays: r.totalWorkingDays,
    excludedWeekendDates: r.excludedWeekendDates || [],
    isExtension: r.isExtension,
    isStopRequest: r.isStopRequest,
    isAdminOnlyDecision: r.isAdminOnlyDecision,
    awaitingAdminDecision: isAwaitingAdminDecision(r),
    currentTurnApproverIds: getCurrentTurnApproverIds(r),
  };
}

function onLeaveWindowFilter(from, to) {
  return {
    status: 'approved',
    isStopRequest: false,
    startDate: { $lte: to },
    $or: [{ actualEndDate: { $gte: from } }, { actualEndDate: null, endDate: { $gte: from } }],
  };
}

export const adminDashboard = asyncHandler(async (req, res) => {
  if (!req.currentUser.organizationId) throw new Error('Your account is not assigned to an organization.');
  const organizationId = req.currentUser.organizationId;
  const organizationEmployeeIds = await User.distinct('_id', { organizationId });
  const organizationDepartmentNames = await User.distinct('department', { organizationId, department: { $nin: [null, ''] } });
  const today = startOfToday();
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  const in7Days = new Date(today);
  in7Days.setDate(in7Days.getDate() + 7);

  const [
    totalActiveEmployees,
    pendingApprovalsCount,
    adminOnlyPendingCount,
    onLeaveTodayDocs,
    upcomingDocs,
    recentAuditActivity,
    departments,
  ] = await Promise.all([
    User.countDocuments({ status: 'active', organizationId }),
    // Whole company: every chain-based pending request AND every admin-only one.
    LeaveRequest.countDocuments({ status: 'pending', employeeId: { $in: organizationEmployeeIds } }),
    LeaveRequest.countDocuments({ status: 'pending', isAdminOnlyDecision: true, employeeId: { $in: organizationEmployeeIds } }),
    LeaveRequest.find({ ...onLeaveWindowFilter(today, endOfToday), employeeId: { $in: organizationEmployeeIds } }).sort({ startDate: 1 }),
    LeaveRequest.find({
      employeeId: { $in: organizationEmployeeIds },
      status: 'approved',
      isStopRequest: false,
      startDate: { $gt: endOfToday, $lte: in7Days },
    }).sort({ startDate: 1 }),
    AuditLog.find({ actorId: { $in: organizationEmployeeIds } }).sort({ createdAt: -1 }).limit(Number(req.query.auditLimit) || 10),
    Department.find({ name: { $in: organizationDepartmentNames } }),
  ]);

  res.json({
    success: true,
    data: {
      totalActiveEmployees,
      pendingApprovalsCount,
      adminOnlyPendingCount,
      onLeaveToday: onLeaveTodayDocs.map(leaveRow),
      upcomingLeaveNext7Days: upcomingDocs.map(leaveRow),
      recentAuditActivity,
      // Nice-to-have from the addendum: which departments still sit on the
      // default 5-day week because nobody explicitly reviewed it.
      departmentsPendingSaturdayReview: departments
        .filter((d) => d.saturdayOff === true)
        .map((d) => ({ id: d._id, name: d.name, saturdayOff: d.saturdayOff })),
    },
  });
});

export const managerDashboard = asyncHandler(async (req, res) => {
  const me = req.currentUser;
  if (!me.organizationId) throw new Error('Your account is not assigned to an organization.');
  const organizationId = me.organizationId;
  const organizationEmployeeIds = await User.distinct('_id', { organizationId });
  const today = startOfToday();
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  const [pendingForMe, teamSize, teamOnLeaveToday, teamCalendar, myBalances, myRequests] =
    await Promise.all([
      LeaveRequest.find({ status: 'pending', employeeId: { $in: organizationEmployeeIds }, requiredApproverIds: me._id }).sort({ createdAt: -1 }),
      User.countDocuments({ status: 'active', organizationId, managerId: me._id }),
      LeaveRequest.find({
        ...onLeaveWindowFilter(today, endOfToday),
        employeeId: { $in: organizationEmployeeIds },
        department: me.department,
      }).sort({ startDate: 1 }),
      LeaveRequest.find({
        status: 'approved',
        isStopRequest: false,
        employeeId: { $in: organizationEmployeeIds },
        department: me.department,
        startDate: { $lte: in30Days },
        $or: [{ actualEndDate: { $gte: today } }, { actualEndDate: null, endDate: { $gte: today } }],
      }).sort({ startDate: 1 }),
      getLeaveBalancesForUser(me._id),
      LeaveRequest.find({ employeeId: me._id }).sort({ createdAt: -1 }).limit(10),
    ]);

  // Only rows where it is actually this manager's turn are actionable now.
  const actionable = pendingForMe.filter((r) =>
    getCurrentTurnApproverIds(r).includes(String(me._id))
  );

  res.json({
    success: true,
    data: {
      teamSize,
      pendingApprovalsCount: actionable.length,
      awaitingOthersCount: pendingForMe.length - actionable.length,
      pendingApprovals: actionable.map(leaveRow),
      teamOnLeaveToday: teamOnLeaveToday.map(leaveRow),
      teamLeaveCalendar: teamCalendar.map(leaveRow),
      // A manager is also an employee: their own balance and requests belong here.
      myBalances,
      myRecentRequests: myRequests.map(leaveRow),
    },
  });
});

export const employeeDashboard = asyncHandler(async (req, res) => {
  const me = req.currentUser;
  const today = startOfToday();

  const [balances, requests, upcoming] = await Promise.all([
    getLeaveBalancesForUser(me._id),
    LeaveRequest.find({ employeeId: me._id }).sort({ createdAt: -1 }).limit(10),
    LeaveRequest.find({
      employeeId: me._id,
      status: 'approved',
      isStopRequest: false,
      $or: [{ actualEndDate: { $gte: today } }, { actualEndDate: null, endDate: { $gte: today } }],
    }).sort({ startDate: 1 }),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  const all = await LeaveRequest.find({ employeeId: me._id }, 'status');
  for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;

  res.json({
    success: true,
    data: {
      balances,
      requestCounts: counts,
      recentRequests: requests.map(leaveRow),
      upcomingLeave: upcoming.map(leaveRow),
    },
  });
});
