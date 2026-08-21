import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

/*
|--------------------------------------------------------------------------
| APPLICANT ELIGIBILITY
|--------------------------------------------------------------------------
|
| Leave entitlement is Grade-based only.
| Department / Designation / Role are intentionally not part of policy scope.
|
*/
export function getGradeQuotaForUser(
  policy,
  user
) {
  if (
    user?.detailsStatus ===
    'pending'
  ) {
    return null;
  }

  if (!user?.gradeId) {
    return null;
  }

  const gradeId =
    String(
      user.gradeId
    );

  const item =
    (
      policy
        .gradeQuotas ||
      []
    ).find(
      (quota) =>
        String(
          quota.gradeId?._id ||
          quota.gradeId
        ) ===
        gradeId
    );

  if (!item) {
    return null;
  }

  const yearlyQuota =
    Number(
      item.yearlyQuota
    );

  return (
    Number.isFinite(
      yearlyQuota
    ) &&
    yearlyQuota > 0
  )
    ? yearlyQuota
    : null;
}

export function checkApplicantScope(
  policy,
  user
) {
  if (
    user?.detailsStatus ===
    'pending'
  ) {
    return 'Employee details must be completed before leave policies can apply.';
  }

  if (
    getGradeQuotaForUser(
      policy,
      user
    ) === null
  ) {
    return 'This leave type is not available for your grade.';
  }

  return null;
}

export async function getAvailableLeaveTypesForUser(
  user
) {
  if (
    user?.detailsStatus ===
    'pending'
  ) {
    return [];
  }

  const policies =
    await LeavePolicy.find({});

  return [
    ...new Set(
      policies
        .filter(
          (policy) =>
            checkApplicantScope(
              policy,
              user
            ) === null
        )
        .map(
          (policy) =>
            policy.leaveType
        )
    ),
  ];
}

/*
 * Kept for existing endpoint compatibility.
 * Policy routing can still optionally use a manual manager chain.
 */
export async function getEligibleApprovers() {
  return User.find({
    role: 'manager',
    status: 'active',
  });
}
