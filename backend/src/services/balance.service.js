import LeaveBalance from '../models/LeaveBalance.js';
import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  checkApplicantScope,
  getGradeQuotaForUser,
} from './eligibility.service.js';

export function getCurrentLeaveYear(
  date = new Date()
) {
  return date.getFullYear();
}

/*
 * Compatibility export. With the final model there is one policy per leaveType,
 * so specificity is no longer needed.
 */
export function policySpecificity() {
  return 1;
}

export async function getPoliciesForUser(
  user
) {
  const bestByType =
    new Map();

  if (
    !user ||
    user.detailsStatus ===
      'pending'
  ) {
    return bestByType;
  }

  const policies =
    await LeavePolicy.find({});

  for (
    const policy
    of policies
  ) {
    if (
      checkApplicantScope(
        policy,
        user
      ) !== null
    ) {
      continue;
    }

    const leaveType =
      String(
        policy.leaveType
      )
        .trim()
        .toLowerCase();

    bestByType.set(
      leaveType,
      policy
    );
  }

  return bestByType;
}

export async function resolvePolicyForBalance(
  employeeId,
  leaveType
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

  if (
    user.detailsStatus ===
    'pending'
  ) {
    throw new ValidationError(
      'Employee details must be completed before leave balances are available.'
    );
  }

  const policies =
    await getPoliciesForUser(
      user
    );

  const policy =
    policies.get(
      String(
        leaveType
      )
        .trim()
        .toLowerCase()
    );

  if (!policy) {
    throw new ValidationError(
      `No leave policy is available for "${leaveType}" for this employee grade.`
    );
  }

  return {
    user,
    policy,
  };
}

function quotaFor(
  policy,
  user
) {
  return Number(
    getGradeQuotaForUser(
      policy,
      user
    ) ||
    0
  );
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

  if (
    user.detailsStatus ===
    'pending'
  ) {
    return [];
  }

  const policies =
    await getPoliciesForUser(
      user
    );

  const balances = [];

  for (
    const [
      leaveType,
      policy,
    ]
    of policies.entries()
  ) {
    const quota =
      quotaFor(
        policy,
        user
      );

    if (
      quota <= 0
    ) {
      continue;
    }

    const balance =
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

    balances.push(
      balance
    );
  }

  const activeLeaveTypes =
    [
      ...policies.keys(),
    ];

  await LeaveBalance.updateMany(
    {
      employeeId,
      year,
      leaveType: {
        $nin:
          activeLeaveTypes,
      },
    },
    {
      $set: {
        quota: 0,
      },
    }
  );

  return balances;
}

export async function syncCurrentYearBalancesForAllEmployees(
  year =
    getCurrentLeaveYear()
) {
  const users =
    await User.find({
      status: 'active',
      detailsStatus: {
        $ne:
          'pending',
      },
    })
      .select('_id');

  for (
    const user
    of users
  ) {
    await syncPolicyBalancesForUser(
      user._id,
      year
    );
  }
}

/*
 * Existing employee controller calls this signature.
 * Grade object is intentionally ignored because LeavePolicy is source of truth.
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

/*
 * Existing employee/taxonomy code may still import this.
 */
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
  const balances =
    await syncPolicyBalancesForUser(
      employeeId,
      year
    );

  const out = {};

  for (
    const row
    of balances
  ) {
    out[
      row.leaveType
    ] = {
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

  return out;
}

async function ensureBalance(
  employeeId,
  leaveType,
  year
) {
  const {
    user,
    policy,
  } =
    await resolvePolicyForBalance(
      employeeId,
      leaveType
    );

  const quota =
    quotaFor(
      policy,
      user
    );

  if (
    quota <= 0
  ) {
    throw new ValidationError(
      `No yearly quota is configured for "${leaveType}" for this employee grade.`
    );
  }

  return LeaveBalance
    .findOneAndUpdate(
      {
        employeeId,
        leaveType:
          String(
            leaveType
          )
            .trim()
            .toLowerCase(),
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

  if (
    amount >
    remaining
  ) {
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
