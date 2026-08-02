import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';

/**
 * Spec Part 6.1 — Applicant scope enforcement (grade & role).
 * approvalRouting.grade/department/designation describe WHO THE POLICY APPLIES
 * TO. They are completely independent of approverIds (who approves it) — an
 * earlier draft conflated the two and it was a real, shipped bug.
 */
export async function getAvailableLeaveTypesForUser(user) {
  const policies = await LeavePolicy.find({});
  return policies
    .filter((p) => {
      if (p.approvalRouting?.grade && String(user.gradeId) !== p.approvalRouting.grade) return false;
      if (
        p.applicableRole &&
        p.applicableRole !== 'All Employees' &&
        p.applicableRole !== user.role
      ) {
        return false;
      }
      return true;
    })
    .map((p) => p.leaveType);
}

/**
 * Re-validated at submission time — the dropdown filtering the frontend shows
 * is a convenience, not a security boundary. Returns an error message string,
 * or null when the policy is available to this user.
 */
export function checkApplicantScope(policy, user) {
  if (policy.approvalRouting?.grade && String(user.gradeId) !== policy.approvalRouting.grade) {
    return 'This leave type is not available for your grade.';
  }
  if (
    policy.applicableRole &&
    policy.applicableRole !== 'All Employees' &&
    policy.applicableRole !== user.role
  ) {
    return 'This leave type is not available for your role.';
  }
  return null;
}

/** Spec Part 6.2 — Cross-department approver eligibility. */
export async function getEligibleApprovers(policyDepartmentFilter) {
  const candidates = await User.find({
    role: { $in: ['manager', 'admin'] },
    status: 'active',
  });
  return candidates.filter((u) => {
    if (u.role === 'admin') return true;
    if (!policyDepartmentFilter || policyDepartmentFilter === 'All Departments') return true;
    if (u.department === policyDepartmentFilter) return true;
    return u.canApproveOtherDepartments === true;
  });
}
