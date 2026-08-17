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
| These are completely separate concepts.
|
*/

export function checkApplicantScope(
  policy,
  user
) {
  const routing =
    policy.approvalRouting || {};

  /*
   * GRADE
   *
   * Policy stores Grade MongoDB ID as string.
   * User stores gradeId as ObjectId.
   */
  if (
    routing.grade &&
    String(user.gradeId) !==
      String(routing.grade)
  ) {
    return 'This leave type is not available for your grade.';
  }

  /*
   * DEPARTMENT
   */
  if (
    routing.department &&
    routing.department !==
      user.department
  ) {
    return 'This leave type is not available for your department.';
  }

  /*
   * DESIGNATION
   */
  if (
    routing.designation &&
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

  /*
   * Same leave type may have multiple policies:
   *
   * Annual + Grade A
   * Annual + Grade B
   *
   * Employee only needs "annual" once in dropdown.
   */
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