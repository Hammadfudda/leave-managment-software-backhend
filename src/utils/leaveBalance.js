const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const LeavePolicy = require('../models/LeavePolicy');
const Holiday = require('../models/Holiday');
const { calculateLeaveDays, getLeaveYearStart, getLeaveYearEnd } = require('./dateUtils');

/**
 * Initialize or reset leave balance for an employee based on their leave policy.
 */
async function initializeLeaveBalance(employeeId) {
  const employee = await Employee.findById(employeeId).populate('leavePolicy');
  if (!employee || !employee.leavePolicy) {
    return null;
  }

  const balances = employee.leavePolicy.leaveTypes.map((lt) => ({
    leaveType: lt.type,
    total: lt.defaultDays,
    used: 0,
    pending: 0,
    carryForwarded: lt.carryForward ? lt.maxCarryForward : 0,
  }));

  employee.leaveBalance = balances;
  await employee.save();
  return employee;
}

/**
 * Recalculate used and pending days from actual leave requests within the current leave year.
 */
async function recalculateLeaveBalance(employeeId) {
  const employee = await Employee.findById(employeeId);
  if (!employee || !employee.leavePolicy) return null;

  const yearStart = getLeaveYearStart();
  const yearEnd = getLeaveYearEnd();

  const requests = await LeaveRequest.find({
    employee: employeeId,
    startDate: { $gte: yearStart, $lte: yearEnd },
    status: { $in: ['approved', 'pending'] },
  });

  const usedByType = {};
  const pendingByType = {};

  for (const req of requests) {
    if (req.status === 'approved') {
      usedByType[req.leaveType] = (usedByType[req.leaveType] || 0) + req.totalDays;
    } else if (req.status === 'pending') {
      pendingByType[req.leaveType] = (pendingByType[req.leaveType] || 0) + req.totalDays;
    }
  }

  const policy = await LeavePolicy.findById(employee.leavePolicy);
  if (!policy) return null;

  employee.leaveBalance = policy.leaveTypes.map((lt) => {
    const existing = employee.leaveBalance.find((b) => b.leaveType === lt.type);
    const carry = existing ? existing.carryForwarded : 0;
    return {
      leaveType: lt.type,
      total: lt.defaultDays + carry,
      used: usedByType[lt.type] || 0,
      pending: pendingByType[lt.type] || 0,
      carryForwarded: carry,
    };
  });

  await employee.save();
  return employee;
}

/**
 * Check if an employee has sufficient leave balance.
 */
async function hasSufficientBalance(employeeId, leaveType, days) {
  const employee = await Employee.findById(employeeId);
  if (!employee) return false;

  const balance = employee.leaveBalance.find((b) => b.leaveType === leaveType);
  if (!balance) return false;

  if (leaveType === 'unpaid') return true;

  const available = balance.total - balance.used - balance.pending;
  return available >= days;
}

/**
 * Get the available balance for a specific leave type.
 */
function getAvailableBalance(employee, leaveType) {
  if (!employee.leaveBalance) return 0;
  const balance = employee.leaveBalance.find((b) => b.leaveType === leaveType);
  if (!balance) return 0;
  return balance.total - balance.used - balance.pending;
}

module.exports = {
  initializeLeaveBalance,
  recalculateLeaveBalance,
  hasSufficientBalance,
  getAvailableBalance,
};
