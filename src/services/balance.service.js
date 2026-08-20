import LeaveBalance from '../models/LeaveBalance.js';
import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  checkApplicantScope,
  getPolicyGradeQuota,
} from './eligibility.service.js';

/*
 * NO CORE_LEAVE_TYPES.
 * Every leave balance comes from Leave Policies.
 */

export function getCurrentLeaveYear(
  date = new Date()
) {
  return date.getFullYear();
}

function specificity(
  policy
) {
  const routing =
    policy.approvalRouting ||
    {};

  let score = 0;

  if (routing.department) {
    score += 2;
  }

  if (routing.designation) {
    score += 1;
  }

  return score;
}

/*
 * One employee may match more than one policy for the same leave type.
 * The most specific Department/Designation policy wins.
 */
export async function getPoliciesForUser(
  user
) {
  const policies =
    await LeavePolicy.find({});

  const matching =
    policies.filter(
      (policy) =>
        checkApplicantScope(
          policy,
          user
        ) === null
    );

  const bestByType =
    new Map();

  for (
    const policy of matching
  ) {
    const type =
      String(
        policy.leaveType
      )
        .trim()
        .toLowerCase();

    const existing =
      bestByType.get(type);

    if (
      !existing ||
      specificity(policy) >
        specificity(existing)
    ) {
      bestByType.set(
        type,
        policy
      );
    }
  }

  return bestByType;
}

export async function syncPolicyBalancesForUser(
  employeeId,
  year =
    getCurrentLeaveYear()
) {
  const user =
    await User.findById(
      employeeId
    );

  if (!user) {
    return [];
  }

  const policies =
    await getPoliciesForUser(
      user
    );

  const activeTypes = [];
  const rows = [];

  for (
    const [
      leaveType,
      policy,
    ] of policies.entries()
  ) {
    const quota =
      Number(
        getPolicyGradeQuota(
          policy,
          user
        ) || 0
      );

    const row =
      await LeaveBalance
        .findOneAndUpdate(
          {
            employeeId,
            leaveType,
            year,
          },
          {
            $set: {
              quota,
            },

            $setOnInsert: {
              used: 0,
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert:
              true,
          }
        );

    activeTypes.push(
      leaveType
    );

    rows.push(row);
  }

  /*
   * If the employee no longer matches a policy this year,
   * keep the ledger/history but make its active entitlement zero.
   */
  await LeaveBalance.updateMany(
    {
      employeeId,
      year,

      leaveType: {
        $nin:
          activeTypes,
      },
    },
    {
      $set: {
        quota: 0,
      },
    }
  );

  return rows;
}

export async function syncCurrentYearBalancesForAllEmployees(
  year =
    getCurrentLeaveYear()
) {
  const users =
    await User.find({
      status: 'active',
    }).select('_id');

  for (const user of users) {
    await syncPolicyBalancesForUser(
      user._id,
      year
    );
  }
}

/*
 * Compatibility with existing employee.controller calls.
 * Grade quotas are ignored because quotas now come from LeavePolicy.gradeQuotas.
 */
export async function initializeLeaveBalances(
  employeeId,
  _grade,
  year =
    getCurrentLeaveYear()
) {
  return syncPolicyBalancesForUser(
    employeeId,
    year
  );
}

export async function syncQuotasToGrade(
  employeeId,
  _grade,
  year =
    getCurrentLeaveYear()
) {
  return syncPolicyBalancesForUser(
    employeeId,
    year
  );
}

export async function getLeaveBalancesForUser(
  employeeId,
  year =
    getCurrentLeaveYear()
) {
  const rows =
    await syncPolicyBalancesForUser(
      employeeId,
      year
    );

  const result = {};

  for (const row of rows) {
    result[row.leaveType] = {
      quota:
        row.quota,

      used:
        row.used,

      remaining:
        Math.max(
          0,
          row.quota -
            row.used
        ),

      year:
        row.year,
    };
  }

  return result;
}

async function ensureBalance(
  employeeId,
  leaveType,
  year
) {
  const user =
    await User.findById(
      employeeId
    );

  if (!user) {
    throw new ValidationError(
      'Employee does not exist.'
    );
  }

  const policies =
    await getPoliciesForUser(
      user
    );

  const key =
    String(leaveType)
      .trim()
      .toLowerCase();

  const policy =
    policies.get(key);

  if (!policy) {
    throw new ValidationError(
      `No leave policy is available for "${leaveType}" for this employee.`
    );
  }

  const quota =
    Number(
      getPolicyGradeQuota(
        policy,
        user
      ) || 0
    );

  return LeaveBalance
    .findOneAndUpdate(
      {
        employeeId,
        leaveType: key,
        year,
      },
      {
        $set: {
          quota,
        },

        $setOnInsert: {
          used: 0,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert:
          true,
      }
    );
}

export async function deductLeaveBalance(
  employeeId,
  leaveType,
  days,
  year =
    getCurrentLeaveYear()
) {
  const amount =
    Number(days);

  if (
    !amount ||
    amount <= 0
  ) {
    return null;
  }

  const balance =
    await ensureBalance(
      employeeId,
      leaveType,
      year
    );

  const remaining =
    Math.max(
      0,
      balance.quota -
        balance.used
    );

  if (amount > remaining) {
    throw new ValidationError(
      `Insufficient ${leaveType} balance. Remaining: ${remaining} day(s), requested: ${amount} day(s).`
    );
  }

  balance.used +=
    amount;

  await balance.save();

  return balance;
}

export async function restoreLeaveBalance(
  employeeId,
  leaveType,
  days,
  year =
    getCurrentLeaveYear()
) {
  const amount =
    Number(days);

  if (
    !amount ||
    amount <= 0
  ) {
    return null;
  }

  const balance =
    await ensureBalance(
      employeeId,
      leaveType,
      year
    );

  balance.used =
    Math.max(
      0,
      balance.used -
        amount
    );

  await balance.save();

  return balance;
}
