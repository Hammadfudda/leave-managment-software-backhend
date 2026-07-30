const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const { asyncHandler } = require('../utils/asyncHandler');
const { getLeaveYearStart, getLeaveYearEnd } = require('../utils/dateUtils');

exports.getLeaveSummaryReport = asyncHandler(async (req, res) => {
  const { year, department, grade } = req.query;
  const yearStart = year ? new Date(parseInt(year), 0, 1) : getLeaveYearStart();
  const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : getLeaveYearEnd();

  const empFilter = {};
  if (department) empFilter.department = department;
  if (grade) empFilter.grade = grade;

  const employees = await Employee.find(empFilter).populate('department designation grade role');

  const summary = [];
  for (const emp of employees) {
    const requests = await LeaveRequest.find({
      employee: emp._id,
      startDate: { $gte: yearStart, $lte: yearEnd },
    });

    const byType = {};
    for (const r of requests) {
      if (!byType[r.leaveType]) byType[r.leaveType] = { approved: 0, pending: 0, rejected: 0, cancelled: 0 };
      if (byType[r.leaveType][r.status] !== undefined) {
        byType[r.leaveType][r.status] += r.totalDays;
      }
    }

    summary.push({
      employee: { id: emp._id, employeeId: emp.employeeId, name: `${emp.firstName} ${emp.lastName}`, department: emp.department?.name, grade: emp.grade?.name },
      leaveBalance: emp.leaveBalance,
      requests: byType,
      totalRequests: requests.length,
    });
  }

  res.status(200).json({ status: 'success', data: { summary, count: summary.length } });
});

exports.getDepartmentReport = asyncHandler(async (req, res) => {
  const { year } = req.query;
  const yearStart = year ? new Date(parseInt(year), 0, 1) : getLeaveYearStart();
  const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : getLeaveYearEnd();

  const departments = await require('../models/Department').find();
  const report = [];

  for (const dept of departments) {
    const empCount = await Employee.countDocuments({ department: dept._id, status: 'active' });
    const leaveCount = await LeaveRequest.countDocuments({
      startDate: { $gte: yearStart, $lte: yearEnd },
      status: 'approved',
    }).populate('employee');

    // Need to filter by department via employee lookup
    const empIds = await Employee.find({ department: dept._id }).distinct('_id');
    const approvedLeaves = await LeaveRequest.find({
      employee: { $in: empIds },
      startDate: { $gte: yearStart, $lte: yearEnd },
      status: 'approved',
    });

    report.push({
      department: { id: dept._id, name: dept.name },
      employeeCount: empCount,
      approvedLeaveCount: approvedLeaves.length,
      totalLeaveDays: approvedLeaves.reduce((sum, r) => sum + r.totalDays, 0),
    });
  }

  res.status(200).json({ status: 'success', data: { report } });
});

exports.exportReportCSV = asyncHandler(async (req, res) => {
  const { Parser } = require('json2csv');
  const { year, department, grade } = req.query;
  const yearStart = year ? new Date(parseInt(year), 0, 1) : getLeaveYearStart();
  const yearEnd = year ? new Date(parseInt(year), 11, 31, 23, 59, 59) : getLeaveYearEnd();

  const empFilter = {};
  if (department) empFilter.department = department;
  if (grade) empFilter.grade = grade;

  const employees = await Employee.find(empFilter).populate('department grade');
  const rows = [];

  for (const emp of employees) {
    const requests = await LeaveRequest.find({
      employee: emp._id,
      startDate: { $gte: yearStart, $lte: yearEnd },
      status: 'approved',
    });

    for (const r of requests) {
      rows.push({
        employeeId: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department?.name || '',
        grade: emp.grade?.name || '',
        leaveType: r.leaveType,
        startDate: r.startDate.toISOString().split('T')[0],
        endDate: r.endDate.toISOString().split('T')[0],
        totalDays: r.totalDays,
        status: r.status,
      });
    }
  }

  const fields = ['employeeId', 'name', 'department', 'grade', 'leaveType', 'startDate', 'endDate', 'totalDays', 'status'];
  const parser = new Parser({ fields });
  const csv = parser.parse(rows);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=leave-report-${new Date().toISOString().split('T')[0]}.csv`);
  res.status(200).send(csv);
});

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalEmployees, activeEmployees, onLeaveToday, pendingApprovals, approvedThisYear, holidaysThisYear,
  ] = await Promise.all([
    Employee.countDocuments(),
    Employee.countDocuments({ status: 'active' }),
    LeaveRequest.countDocuments({ status: 'approved', startDate: { $lte: today }, endDate: { $gte: today } }),
    LeaveRequest.countDocuments({ status: 'pending' }),
    LeaveRequest.countDocuments({ status: 'approved', startDate: { $gte: getLeaveYearStart() } }),
    Holiday.countDocuments({ date: { $gte: getLeaveYearStart(), $lte: getLeaveYearEnd() } }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      stats: { totalEmployees, activeEmployees, onLeaveToday, pendingApprovals, approvedThisYear, holidaysThisYear },
    },
  });
});
