const Holiday = require('../models/Holiday');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');

exports.createHoliday = asyncHandler(async (req, res) => {
  const { name, date, type, applicableDepartments, isRecurring } = req.body;
  if (!name || !date) throw new ValidationError('Name and date are required.');

  const holiday = await Holiday.create({ name, date, type: type || 'public', applicableDepartments, isRecurring });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_holiday', target: holiday._id, targetModel: 'Holiday', description: `Holiday ${name} created`, req });
  res.status(201).json({ status: 'success', message: 'Holiday created.', data: { holiday } });
});

exports.getHolidays = asyncHandler(async (req, res) => {
  const { year, type } = req.query;
  const filter = {};
  if (type) filter.type = type;
  if (year) {
    const start = new Date(parseInt(year), 0, 1);
    const end = new Date(parseInt(year), 11, 31, 23, 59, 59);
    filter.date = { $gte: start, $lte: end };
  }

  const holidays = await Holiday.find(filter).populate('applicableDepartments', 'name').sort('date');
  res.status(200).json({ status: 'success', data: { holidays, count: holidays.length } });
});

exports.getHolidayById = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findById(req.params.id).populate('applicableDepartments', 'name');
  if (!holiday) throw new NotFoundError('Holiday');
  res.status(200).json({ status: 'success', data: { holiday } });
});

exports.updateHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!holiday) throw new NotFoundError('Holiday');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_holiday', target: holiday._id, targetModel: 'Holiday', description: `Holiday ${holiday.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Holiday updated.', data: { holiday } });
});

exports.deleteHoliday = asyncHandler(async (req, res) => {
  const holiday = await Holiday.findByIdAndDelete(req.params.id);
  if (!holiday) throw new NotFoundError('Holiday');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_holiday', target: holiday._id, targetModel: 'Holiday', description: `Holiday ${holiday.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Holiday deleted.' });
});

exports.getCalendar = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  if (!month || !year) throw new ValidationError('month and year are required.');

  const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
  const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

  const holidays = await Holiday.find({ date: { $gte: startOfMonth, $lte: endOfMonth } }).sort('date');

  // Get approved leaves for this month visible to the requester
  const LeaveRequest = require('../models/LeaveRequest');
  const Employee = require('../models/Employee');

  let leaveFilter = {
    status: 'approved',
    startDate: { $lte: endOfMonth },
    endDate: { $gte: startOfMonth },
  };

  const requesterRole = req.employee?.role?.name || req.user?.role;
  if (requesterRole === 'Employee') {
    leaveFilter.employee = req.employee._id;
  } else if (requesterRole === 'Team Lead' || requesterRole === 'Manager') {
    const teamIds = await Employee.find({
      $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
    }).distinct('_id');
    teamIds.push(req.employee._id);
    leaveFilter.employee = { $in: teamIds };
  }

  const leaves = await LeaveRequest.find(leaveFilter)
    .populate('employee', 'firstName lastName employeeId avatar')
    .sort('startDate');

  res.status(200).json({
    status: 'success',
    data: { holidays, leaves, holidayCount: holidays.length, leaveCount: leaves.length },
  });
});
