import LeaveRequest from '../models/LeaveRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Spec Part 11 — GET /api/calendar.
 * Approved leave only; pending requests are not on anybody's calendar. An
 * employee sees their own entries, a manager their department's, Admin all.
 */
export const calendar = asyncHandler(async (req, res) => {
  const now = new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = req.query.to
    ? new Date(req.query.to)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0);
  to.setHours(23, 59, 59, 999);

  const filter = {
    status: 'approved',
    isStopRequest: false,
    // Any leave that overlaps the window at all, not just ones starting in it.
    startDate: { $lte: to },
    $or: [{ actualEndDate: { $gte: from } }, { actualEndDate: null, endDate: { $gte: from } }],
  };

  if (req.currentUser.role === 'employee') {
    filter.employeeId = req.currentUser._id;
  } else if (req.currentUser.role === 'manager') {
    filter.department = req.currentUser.department;
  }
  if (req.query.department && req.currentUser.role === 'admin') {
    filter.department = req.query.department;
  }

  const requests = await LeaveRequest.find(filter).sort({ startDate: 1 });

  res.json({
    success: true,
    data: requests.map((r) => ({
      id: r._id,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      department: r.department,
      leaveType: r.leaveType,
      start: new Date(r.startDate).toISOString().split('T')[0],
      end: new Date(r.actualEndDate || r.endDate).toISOString().split('T')[0],
      workingDays: r.totalWorkingDays,
      excludedWeekendDates: r.excludedWeekendDates,
      isExtension: r.isExtension,
      endedEarly: Boolean(r.actualEndDate),
    })),
  });
});
