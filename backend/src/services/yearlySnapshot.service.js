import Grade from '../models/Grade.js';
import User from '../models/User.js';
import YearlyLeaveSnapshot from '../models/YearlyLeaveSnapshot.js';
import { resolveLeaveYearForUser } from './leaveYear.service.js';

async function getUser(employeeId, session) {
  let query = User.findById(employeeId).populate('gradeId');

  if (session) {
    query = query.session(session);
  }

  return query;
}

export async function upsertYearlySnapshotForBalance(
  balance,
  user = null,
  options = {}
) {
  const employee =
    user ||
    (await getUser(balance.employeeId, options.session));

  if (!employee) {
    return null;
  }

  let grade = employee.gradeId;

  if (grade && typeof grade === 'string') {
    let gradeQuery = Grade.findById(grade);

    if (options.session) {
      gradeQuery = gradeQuery.session(options.session);
    }

    grade = await gradeQuery;
  }

  const currentLeaveYear = await resolveLeaveYearForUser(
    employee,
    new Date(),
    options
  );

  let existingQuery = YearlyLeaveSnapshot.findOne({
    leaveYear: balance.year,
    employeeId: employee._id,
    leaveType: balance.leaveType,
  });

  if (options.session) {
    existingQuery = existingQuery.session(options.session);
  }

  const existing = await existingQuery;

  /*
   * Once a leave year is in the past, do not rewrite its classification
   * using a later promotion / transfer.
   */
  if (
    existing &&
    Number(balance.year) < Number(currentLeaveYear)
  ) {
    return existing;
  }

  const payload = {
    leaveYear: balance.year,
    employeeId: employee._id,
    employeeCode: employee.employeeId || '',
    employeeName: employee.fullName || '',
    division: employee.roleLabel || '',
    department: employee.department || '',
    designation: employee.designation || '',
    grade: grade?.name || '',
    leaveType: balance.leaveType,
    granted: Number(balance.quota || 0),
    used: Number(balance.used || 0),
    remaining: Math.max(
      0,
      Number(balance.quota || 0) - Number(balance.used || 0)
    ),
    employeeStatus: employee.status || '',
    detailsStatus: employee.detailsStatus || '',
    capturedAt: new Date(),
  };

  return YearlyLeaveSnapshot.findOneAndUpdate(
    {
      leaveYear: balance.year,
      employeeId: employee._id,
      leaveType: balance.leaveType,
    },
    {
      $set: payload,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session: options.session,
    }
  );
}
