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

export function checkApplicantScope(
  policy,
  user
) {
  const routing =
    policy.approvalRouting ||
    {};

  if (
    !isWildcard(
      routing.grade,
      'All Grades'
    ) &&
    String(
      user.gradeId
    ) !==
      String(
        routing.grade
      )
  ) {
    return 'This leave type is not available for your grade.';
  }

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
        Number(
          policy.yearlyQuota ??
            0
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

export async function getEligibleApprovers(
  policyDepartmentFilter
) {
  const candidates = await User.find({ role: 'manager', status: 'active' });

  return candidates;

}
