import { Parser } from 'json2csv';

import LeaveBalance from '../models/LeaveBalance.js';
import User from '../models/User.js';
import YearlyLeaveSnapshot from '../models/YearlyLeaveSnapshot.js';

import { asyncHandler } from '../utils/asyncHandler.js';
import { ValidationError } from '../utils/errors.js';

import { resolveLeaveYearForUser } from '../services/leaveYear.service.js';
import { syncPolicyBalancesForUser } from '../services/balance.service.js';
import { upsertYearlySnapshotForBalance } from '../services/yearlySnapshot.service.js';

function parseYear(value) {
  const year = Number(value);

  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2200
  ) {
    throw new ValidationError('A valid leave year is required.');
  }

  return year;
}

async function refreshCurrentYearSnapshots(year) {
  const users = await User.find({
    status: {
      $ne: 'pending_deletion',
    },
    detailsStatus: {
      $ne: 'pending',
    },
  }).populate('gradeId');

  for (const user of users) {
    const currentYear = await resolveLeaveYearForUser(user);

    /*
     * Past years are never reconstructed from the employee's current
     * department / grade / designation.
     */
    if (Number(currentYear) !== Number(year)) {
      continue;
    }

    await syncPolicyBalancesForUser(user._id, year);

    const balances = await LeaveBalance.find({
      employeeId: user._id,
      year,
    });

    for (const balance of balances) {
      await upsertYearlySnapshotForBalance(
        balance,
        user
      );
    }
  }
}

async function rowsForYear(year) {
  await refreshCurrentYearSnapshots(year);

  return YearlyLeaveSnapshot.find({
    leaveYear: year,
  })
    .sort({
      employeeName: 1,
      leaveType: 1,
    })
    .lean();
}

export const listYearlyReport = asyncHandler(
  async (req, res) => {
    const year = parseYear(req.query.year);
    const rows = await rowsForYear(year);

    res.json({
      success: true,
      data: rows,
    });
  }
);

export const exportYearlyReportCsv = asyncHandler(
  async (req, res) => {
    const year = parseYear(req.query.year);
    const snapshots = await rowsForYear(year);

    const rows = snapshots.map((row) => ({
      leaveYear: row.leaveYear,
      employeeId: row.employeeCode,
      employeeName: row.employeeName,
      division: row.division,
      department: row.department,
      designation: row.designation,
      grade: row.grade,
      leaveType: row.leaveType,
      granted: row.granted,
      used: row.used,
      remaining: row.remaining,
      employeeStatus: row.employeeStatus,
      detailsStatus: row.detailsStatus,
      capturedAt: row.capturedAt
        ? new Date(row.capturedAt).toISOString()
        : '',
    }));

    const parser = new Parser({
      fields: [
        'leaveYear',
        'employeeId',
        'employeeName',
        'division',
        'department',
        'designation',
        'grade',
        'leaveType',
        'granted',
        'used',
        'remaining',
        'employeeStatus',
        'detailsStatus',
        'capturedAt',
      ],
    });

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`yearly-leave-report-${year}.csv`);
    res.send(parser.parse(rows));
  }
);
