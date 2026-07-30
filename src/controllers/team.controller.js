const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');

exports.getMyTeam = asyncHandler(async (req, res) => {
  const team = await Employee.find({
    $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
  }).populate('department designation grade role').sort('firstName');

  res.status(200).json({ status: 'success', data: { team, count: team.length } });
});

exports.getTeamOnLeaveToday = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const teamIds = await Employee.find({
    $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
  }).distinct('_id');

  const onLeave = await LeaveRequest.find({
    employee: { $in: teamIds },
    status: 'approved',
    startDate: { $lte: today },
    endDate: { $gte: today },
  }).populate('employee', 'firstName lastName email employeeId avatar');

  res.status(200).json({ status: 'success', data: { onLeave, count: onLeave.length } });
});

exports.getTeamLeaveCalendar = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) throw new ValidationError('month and year are required.');

  const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
  const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

  const teamIds = await Employee.find({
    $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
  }).distinct('_id');

  const requests = await LeaveRequest.find({
    employee: { $in: teamIds },
    status: { $in: ['approved', 'pending'] },
    startDate: { $lte: endOfMonth },
    endDate: { $gte: startOfMonth },
  }).populate('employee', 'firstName lastName employeeId avatar');

  res.status(200).json({ status: 'success', data: { requests, count: requests.length } });
});

exports.getTeamLeaveStats = asyncHandler(async (req, res) => {
  const teamIds = await Employee.find({
    $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
  }).distinct('_id');

  const [pending, approved, rejected, cancelled] = await Promise.all([
    LeaveRequest.countDocuments({ employee: { $in: teamIds }, status: 'pending' }),
    LeaveRequest.countDocuments({ employee: { $in: teamIds }, status: 'approved' }),
    LeaveRequest.countDocuments({ employee: { $in: teamIds }, status: 'rejected' }),
    LeaveRequest.countDocuments({ employee: { $in: teamIds }, status: 'cancelled' }),
  ]);

  res.status(200).json({
    status: 'success',
    data: { stats: { pending, approved, rejected, cancelled, total: pending + approved + rejected + cancelled } },
  });
});
