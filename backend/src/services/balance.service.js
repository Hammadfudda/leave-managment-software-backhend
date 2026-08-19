import LeaveBalance from '../models/LeaveBalance.js';
import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  checkApplicantScope,
} from './eligibility.service.js';

/*
|--------------------------------------------------------------------------
| YEAR
|--------------------------------------------------------------------------
|
| Every calendar year has its own ledger row:
| employeeId + leaveType + year.
|
| When 2027 begins, new 2027 rows are initialized from the policies that are
| valid at that time. 2026 rows remain untouched for history.
|
*/
export function getCurrentLeaveYear(
  date = new Date()
) {
  return date.getFullYear();
}

function isSpecific(
  value,
  allLabel
) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    value !== allLabel
  );
}

/*
|--------------------------------------------------------------------------
| POLICY SPECIFICITY
|--------------------------------------------------------------------------
|
| If multiple policies of the same leaveType match an employee, the most
| specific one wins:
|
| Grade       = 4
| Department  = 2
| Designation = 1
|
*/
export function policySpecificity(
  policy
) {
  const routing =
    policy.approvalRouting || {};

  return (
    (
      isSpecific(
        routing.grade,
        'All Grades'
      )
        ? 4
        : 0
    ) +
    (
      isSpecific(
        routing.department,
        'All Departments'
      )
        ? 2
        : 0
    ) +
    (
      isSpecific(
        routing.designation,
        'All Designations'
      )
        ? 1
        : 0
    )
  );
}

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
    const leaveType =
      String(
        policy.leaveType
      )
        .trim()
        .toLowerCase();

    const existing =
      bestByType.get(
        leaveType
      );

    if (
      !existing ||
      policySpecificity(
        policy
      ) >
        policySpecificity(
          existing
        )
    ) {
      bestByType.set(
        leaveType,
        policy
      );
    }
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

  const policies =
    await getPoliciesForUser(
      user
    );

  const policy =
    policies.get(
      String(leaveType)
        .trim()
        .toLowerCase()
    );

  if (!policy) {
    throw new ValidationError(
      `No leave policy is available for "${leaveType}" for this employee.`
    );
  }

  return {
    user,
    policy,
  };
}

/*
|--------------------------------------------------------------------------
| SYNC ONE EMPLOYEE
|--------------------------------------------------------------------------
|
| Quota comes ONLY from LeavePolicy.yearlyQuota.
| Grade's old annual/sick/casual quota fields are not used here.
|
| used is never reset inside the same year.
|--------------------------------------------------------------------------
*/
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

  const applicableTypes =
    [];

  for (
    const [
      leaveType,
      policy,
    ] of policies.entries()
  ) {
    const quota =
      Number(
        policy.yearlyQuota ??
          0
      );

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

    applicableTypes.push(
      balance
    );
  }

  /*
   * Preserve old history rows if policy is removed / employee changes grade,
   * but make them unavailable in the current year's active entitlement.
   */
  const activeLeaveTypes = [
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

  return applicableTypes;
}

/*
|--------------------------------------------------------------------------
| SYNC ALL ACTIVE USERS
|--------------------------------------------------------------------------
|
| Called after Admin creates, updates or deletes a policy so My Team / Apply
| Leave reflect the new entitlement immediately.
|--------------------------------------------------------------------------
*/
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
|--------------------------------------------------------------------------
| INITIALIZE COMPATIBILITY
|--------------------------------------------------------------------------
|
| Existing employee.controller may call initializeLeaveBalances(employeeId,
| grade). We keep the function signature compatible, but ignore the Grade
| object because the source of truth is now LeavePolicy.
|--------------------------------------------------------------------------
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
|--------------------------------------------------------------------------
| GRADE CHANGE COMPATIBILITY
|--------------------------------------------------------------------------
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

/*
|--------------------------------------------------------------------------
| READ BALANCES
|--------------------------------------------------------------------------
*/
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
    const row of balances
  ) {
    out[row.leaveType] = {
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
    policy,
  } =
    await resolvePolicyForBalance(
      employeeId,
      leaveType
    );

  const quota =
    Number(
      policy.yearlyQuota ??
        0
    );

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

/*
|--------------------------------------------------------------------------
| DEDUCT
|--------------------------------------------------------------------------
|
| Called only after final approval by approval.service.js.
| Prevents an approved request from exceeding the yearly entitlement.
|--------------------------------------------------------------------------
*/
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

/*
|--------------------------------------------------------------------------
| RESTORE
|--------------------------------------------------------------------------
|
| Used when an approved leave is shortened/stopped. The unused days are
| restored to the SAME yearly ledger.
|--------------------------------------------------------------------------
*/
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
