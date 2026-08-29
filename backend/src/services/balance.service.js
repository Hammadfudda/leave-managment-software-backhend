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

import {
  calculateProratedQuota,
  getOrganizationLeaveYearConfig,
  resolveLeaveYearForUser,
} from './leaveYear.service.js';

import {
  upsertYearlySnapshotForBalance,
} from './yearlySnapshot.service.js';

/*
 * Compatibility export for older callers that explicitly need calendar year.
 * Normal balance operations resolve the organization's configured leave year.
 */
export function getCurrentLeaveYear(
  date = new Date()
) {
  return date.getFullYear();
}

export function policySpecificity() {
  return 1;
}

function withSession(
  query,
  session
) {
  return session
    ? query.session(session)
    : query;
}

export async function getPoliciesForUser(
  user,
  options = {}
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

  let query =
    LeavePolicy.find({});

  query =
    withSession(
      query,
      options.session
    );

  const policies =
    await query;

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
  leaveType,
  options = {}
) {
  let userQuery =
    User.findById(
      employeeId
    );

  userQuery =
    withSession(
      userQuery,
      options.session
    );

  const user =
    await userQuery;

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
      user,
      options
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

async function resolveYear(
  user,
  year,
  referenceDate,
  options
) {
  if (
    year !==
      undefined &&
    year !==
      null &&
    year !==
      ''
  ) {
    return Number(
      year
    );
  }

  return resolveLeaveYearForUser(
    user,
    referenceDate ||
      new Date(),
    options
  );
}

async function proratedQuota(
  policy,
  user,
  year,
  options
) {
  const yearlyQuota =
    Number(
      getGradeQuotaForUser(
        policy,
        user
      ) ||
      0
    );

  const config =
    await getOrganizationLeaveYearConfig(
      user.organizationId,
      options
    );

  return calculateProratedQuota({
    yearlyQuota,
    dateOfJoining:
      user.dateOfJoining,
    leaveYear:
      year,
    config,
  });
}

export async function syncPolicyBalancesForUser(
  employeeId,
  year = null,
  options = {}
) {
  let userQuery =
    User.findById(
      employeeId
    );

  userQuery =
    withSession(
      userQuery,
      options.session
    );

  const user =
    await userQuery;

  if (!user) {
    return [];
  }

  if (
    user.detailsStatus ===
    'pending'
  ) {
    return [];
  }

  const selectedYear =
    await resolveYear(
      user,
      year,
      options.referenceDate,
      options
    );

  const currentYear =
    await resolveLeaveYearForUser(
      user,
      new Date(),
      options
    );

  const policies =
    await getPoliciesForUser(
      user,
      options
    );

  const balances =
    [];

  for (
    const [
      leaveType,
      policy,
    ]
    of policies.entries()
  ) {
    const quota =
      await proratedQuota(
        policy,
        user,
        selectedYear,
        options
      );

    if (
      quota <= 0
    ) {
      continue;
    }

    let balanceQuery =
      LeaveBalance.findOne({
        employeeId,
        leaveType,
        year:
          selectedYear,
      });

    balanceQuery =
      withSession(
        balanceQuery,
        options.session
      );

    let balance =
      await balanceQuery;

    if (!balance) {
      const created =
        await LeaveBalance.create(
          [
            {
              employeeId,
              leaveType,
              year:
                selectedYear,
              quota,
              used: 0,
            },
          ],
          options.session
            ? {
                session:
                  options.session,
              }
            : {}
        );

      balance =
        created[0];
    } else if (
      Number(
        selectedYear
      ) >=
      Number(
        currentYear
      )
    ) {
      /*
       * Current/future year quota follows the current Grade + Policy.
       * Past-year granted quota remains historical.
       */
      balance.quota =
        quota;

      await balance.save(
        options.session
          ? {
              session:
                options.session,
            }
          : {}
      );
    }

    balances.push(
      balance
    );

    await upsertYearlySnapshotForBalance(
      balance,
      user,
      options
    );
  }

  if (
    Number(
      selectedYear
    ) >=
    Number(
      currentYear
    )
  ) {
    const activeLeaveTypes =
      [
        ...policies.keys(),
      ];

    await LeaveBalance.updateMany(
      {
        employeeId,
        year:
          selectedYear,
        leaveType: {
          $nin:
            activeLeaveTypes,
        },
      },
      {
        $set: {
          quota: 0,
        },
      },
      options.session
        ? {
            session:
              options.session,
          }
        : {}
    );
  }

  return balances;
}

export async function syncCurrentYearBalancesForAllEmployees(
  year = null,
  options = {}
) {
  let usersQuery =
    User.find({
      status:
        'active',
      detailsStatus: {
        $ne:
          'pending',
      },
    })
      .select(
        '_id'
      );

  usersQuery =
    withSession(
      usersQuery,
      options.session
    );

  const users =
    await usersQuery;

  for (
    const user
    of users
  ) {
    await syncPolicyBalancesForUser(
      user._id,
      year,
      options
    );
  }
}

export async function initializeLeaveBalances(
  employeeId,
  _grade,
  year = null,
  options = {}
) {
  return syncPolicyBalancesForUser(
    employeeId,
    year,
    options
  );
}

export async function syncQuotasToGrade(
  employeeId,
  _grade,
  year = null,
  options = {}
) {
  return syncPolicyBalancesForUser(
    employeeId,
    year,
    options
  );
}

export async function getLeaveBalancesForUser(
  employeeId,
  year = null,
  options = {}
) {
  const balances =
    await syncPolicyBalancesForUser(
      employeeId,
      year,
      options
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
      granted:
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
  year = null,
  options = {}
) {
  const {
    user,
    policy,
  } =
    await resolvePolicyForBalance(
      employeeId,
      leaveType,
      options
    );

  const selectedYear =
    await resolveYear(
      user,
      year,
      options.referenceDate,
      options
    );

  const quota =
    await proratedQuota(
      policy,
      user,
      selectedYear,
      options
    );

  if (
    quota <= 0
  ) {
    throw new ValidationError(
      `No yearly quota is configured for "${leaveType}" for this employee grade.`
    );
  }

  let balanceQuery =
    LeaveBalance.findOne({
      employeeId,
      leaveType:
        String(
          leaveType
        )
          .trim()
          .toLowerCase(),
      year:
        selectedYear,
    });

  balanceQuery =
    withSession(
      balanceQuery,
      options.session
    );

  let balance =
    await balanceQuery;

  if (!balance) {
    const created =
      await LeaveBalance.create(
        [
          {
            employeeId,
            leaveType:
              String(
                leaveType
              )
                .trim()
                .toLowerCase(),
            year:
              selectedYear,
            quota,
            used: 0,
          },
        ],
        options.session
          ? {
              session:
                options.session,
            }
          : {}
      );

    balance =
      created[0];
  }

  return {
    balance,
    user,
  };
}

export async function deductLeaveBalance(
  employeeId,
  leaveType,
  days,
  year = null,
  options = {}
) {
  const amount =
    Number(days);

  if (
    !amount ||
    amount <= 0
  ) {
    return null;
  }

  const {
    balance,
    user,
  } =
    await ensureBalance(
      employeeId,
      leaveType,
      year,
      options
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

  await balance.save(
    options.session
      ? {
          session:
            options.session,
        }
      : {}
  );

  await upsertYearlySnapshotForBalance(
    balance,
    user,
    options
  );

  return balance;
}

export async function restoreLeaveBalance(
  employeeId,
  leaveType,
  days,
  year = null,
  options = {}
) {
  const amount =
    Number(days);

  if (
    !amount ||
    amount <= 0
  ) {
    return null;
  }

  const {
    balance,
    user,
  } =
    await ensureBalance(
      employeeId,
      leaveType,
      year,
      options
    );

  balance.used =
    Math.max(
      0,
      balance.used -
        amount
    );

  await balance.save(
    options.session
      ? {
          session:
            options.session,
        }
      : {}
  );

  await upsertYearlySnapshotForBalance(
    balance,
    user,
    options
  );

  return balance;
}
