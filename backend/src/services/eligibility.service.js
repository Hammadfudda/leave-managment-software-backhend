import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

function isAll(value, allLabel) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    value === allLabel
  );
}

function policyMatchesUser(policy, user) {
  const routing =
    policy.approvalRouting || {};

  if (
    !isAll(routing.grade, 'All Grades') &&
    String(user.gradeId) !==
      String(routing.grade)
  ) {
    return false;
  }

  if (
    !isAll(
      routing.department,
      'All Departments'
    ) &&
    user.department !==
      routing.department
  ) {
    return false;
  }

  if (
    !isAll(
      routing.designation,
      'All Designations'
    ) &&
    user.designation !==
      routing.designation
  ) {
    return false;
  }

  if (
    policy.applicableRole &&
    policy.applicableRole !==
      'All Employees' &&
    policy.applicableRole !==
      user.role
  ) {
    return false;
  }

  return true;
}

export async function getAvailableLeaveTypesForUser(
  user
) {
  const policies =
    await LeavePolicy.find({});

  return [
    ...new Set(
      policies
        .filter((policy) =>
          policyMatchesUser(
            policy,
            user
          )
        )
        .map(
          (policy) =>
            policy.leaveType
        )
    ),
  ];
}

export function checkApplicantScope(
  policy,
  user
) {
  const routing =
    policy.approvalRouting || {};

  if (
    !isAll(routing.grade, 'All Grades') &&
    String(user.gradeId) !==
      String(routing.grade)
  ) {
    return 'This leave type is not available for your grade.';
  }

  if (
    !isAll(
      routing.department,
      'All Departments'
    ) &&
    user.department !==
      routing.department
  ) {
    return 'This leave type is not available for your department.';
  }

  if (
    !isAll(
      routing.designation,
      'All Designations'
    ) &&
    user.designation !==
      routing.designation
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

export async function getEligibleApprovers(
  policyDepartmentFilter
) {
  const candidates =
    await User.find({
      role: {
        $in: [
          'manager',
          'admin',
        ],
      },
      status: 'active',
    });

  return candidates.filter(
    (user) => {
      if (
        user.role === 'admin'
      ) {
        return true;
      }

      if (
        !policyDepartmentFilter ||
        policyDepartmentFilter ===
          'All Departments'
      ) {
        return true;
      }

      if (
        user.department ===
        policyDepartmentFilter
      ) {
        return true;
      }

      return (
        user.canApproveOtherDepartments ===
        true
      );
    }
  );
}