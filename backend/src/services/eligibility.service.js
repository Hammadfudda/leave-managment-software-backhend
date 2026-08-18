import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

/*
|--------------------------------------------------------------------------
| POLICY APPLICANT SCOPE
|--------------------------------------------------------------------------
|
| approvalRouting.grade / department / designation determine
| WHO the policy applies to.
|
| approvalRouting.approverIds determines WHO approves it.
|
| "All Grades", "All Departments", "All Designations",
| null and empty values are treated as wildcards.
|
*/

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
    policy.approvalRouting || {};

  /*
   * GRADE
   *
   * Specific grade stores Grade MongoDB ID.
   * "All Grades" means every grade.
   */
  if (
    !isWildcard(
      routing.grade,
      'All Grades'
    ) &&
    String(user.gradeId) !==
      String(
        routing.grade
      )
  ) {
    return 'This leave type is not available for your grade.';
  }

  /*
   * DEPARTMENT
   */
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

  /*
   * DESIGNATION
   */
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

  /*
   * ROLE
   */
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

/*
|--------------------------------------------------------------------------
| AVAILABLE LEAVE TYPES FOR EMPLOYEE
|--------------------------------------------------------------------------
*/
export async function getAvailableLeaveTypesForUser(
  user
) {
  const policies =
    await LeavePolicy.find({});

  const matchingPolicies =
    policies.filter(
      (policy) =>
        checkApplicantScope(
          policy,
          user
        ) === null
    );

  return [
    ...new Set(
      matchingPolicies.map(
        (policy) =>
          policy.leaveType
      )
    ),
  ];
}

/*
|--------------------------------------------------------------------------
| ELIGIBLE APPROVERS
|--------------------------------------------------------------------------
*/
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
        user.role ===
        'admin'
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
