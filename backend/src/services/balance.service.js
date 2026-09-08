import LeaveBalance from '../models/LeaveBalance.js';
import Grade from '../models/Grade.js';
import User from '../models/User.js';

export const CORE_LEAVE_TYPES = ['annual', 'sick', 'casual'];

function quotaFor(grade, leaveType) {
  if (!grade) return 0;
  if (leaveType === 'annual') return grade.annualLeaveQuota ?? 0;
  if (leaveType === 'sick') return grade.sickLeaveQuota ?? 0;
  if (leaveType === 'casual') return grade.casualLeaveQuota ?? 0;
  return 0; // custom / unpaid types are uncapped unless Admin sets a quota
}

/** Creates the annual/sick/casual balance records from the grade's quotas. */
export async function initializeLeaveBalances(employeeId, grade, year = new Date().getFullYear()) {
  const results = [];
  for (const leaveType of CORE_LEAVE_TYPES) {
    const balance = await LeaveBalance.findOneAndUpdate(
      { employeeId, leaveType, year },
      { $setOnInsert: { quota: quotaFor(grade, leaveType), used: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(balance);
  }
  return results;
}

/** Re-syncs quotas after a grade change or grade quota edit. `used` is preserved. */
export async function syncQuotasToGrade(employeeId, grade, year = new Date().getFullYear()) {
  for (const leaveType of CORE_LEAVE_TYPES) {
    await LeaveBalance.findOneAndUpdate(
      { employeeId, leaveType, year },
      { $set: { quota: quotaFor(grade, leaveType) }, $setOnInsert: { used: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

/**
 * Returns { annual: { quota, used, remaining }, ... }.
 * `remaining` is always derived, never stored — the two can't drift apart.
 */
export async function getLeaveBalancesForUser(employeeId, year = new Date().getFullYear()) {
  const user = await User.findById(employeeId);
  if (user) {
    const grade = await Grade.findById(user.gradeId);
    await initializeLeaveBalances(employeeId, grade, year);
  }
  const rows = await LeaveBalance.find({ employeeId, year });
  const out = {};
  for (const row of rows) {
    out[row.leaveType] = {
      quota: row.quota,
      used: row.used,
      remaining: Math.max(0, row.quota - row.used),
    };
  }
  return out;
}

async function ensureBalance(employeeId, leaveType, year) {
  let balance = await LeaveBalance.findOne({ employeeId, leaveType, year });
  if (!balance) {
    const user = await User.findById(employeeId);
    const grade = user ? await Grade.findById(user.gradeId) : null;
    balance = await LeaveBalance.create({
      employeeId,
      leaveType,
      year,
      quota: quotaFor(grade, leaveType),
      used: 0,
    });
  }
  return balance;
}

export async function deductLeaveBalance(employeeId, leaveType, days, year = new Date().getFullYear()) {
  if (!days || days <= 0) return null;
  const balance = await ensureBalance(employeeId, leaveType, year);
  balance.used += days;
  await balance.save();
  return balance;
}

export async function restoreLeaveBalance(employeeId, leaveType, days, year = new Date().getFullYear()) {
  if (!days || days <= 0) return null;
  const balance = await ensureBalance(employeeId, leaveType, year);
  balance.used = Math.max(0, balance.used - days);
  await balance.save();
  return balance;
}
