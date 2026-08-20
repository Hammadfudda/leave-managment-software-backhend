import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

function isWildcard(
  value,
  allLabel
) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    value === allLabel
  );
}

export function getPolicyGradeQuota(
  policy,
  user
) {
  const gradeId =
    String(
      user.gradeId || ''
    );

  const row =
    (
      policy.gradeQuotas ||
      []
    ).find(
      (item) =>
        String(
          item.gradeId
        ) === gradeId
    );

  return row
    ? Number(
        row.yearlyQuota || 0
      )
    : null;
}

export function checkApplicantScope(
  policy,
  user
) {
  /*
   * Employee's Grade MUST exist in policy.gradeQuotas.
   * There is no hard-coded "All Grades" balance anymore.
   */
  const gradeQuota =
    getPolicyGradeQuota(
      policy,
      user
    );

  if (gradeQuota === null) {
    return 'This leave type is not available for your grade.';
  }

  const routing =
    policy.approvalRouting ||
    {};

  if (
    !isWildcard(
      routing.department,
      'All Departments'
    ) &&
    routing.department !==
      user.department
  ) {
    return 'This leave type is not available for your department.';
  }

  if (
    !isWildcard(
      routing.designation,
      'All Designations'
    ) &&
    routing.designation !==
      user.designation
  ) {
    return 'This leave type is not available for your designation.';
  }

  if (
    policy.applicableRole &&
    policy.applicableRole !==
      'All Employees' &&
    policy.applicableRole !==
      user.role
  ) {
    return 'This leave type is not available for your role.';
  }

  return null;
}

export async function getAvailableLeaveTypesForUser(
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
        ) === null &&
        (
          getPolicyGradeQuota(
            policy,
            user
          ) || 0
        ) > 0
    );

  return [
    ...new Set(
      matching.map(
        (policy) =>
          policy.leaveType
      )
    ),
  ];
}

/*
 * Policy routing candidates are MANAGERS only.
 * Admin is not selectable as a Leave Policy approver.
 *
 * We return managers from every department so Admin can explicitly
 * route a policy to a manager from another department.
 */
export async function getEligibleApprovers() {
  return User.find({
    role: 'manager',
    status: 'active',
  }).sort({
    fullName: 1,
  });
}
