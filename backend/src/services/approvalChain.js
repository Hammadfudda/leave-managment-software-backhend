/**
 * Spec Part 5 — the sequential gatekeeper chain.
 *
 * Pure functions only, and deliberately kept in their own module so both the
 * approval service and the notification service can use them without a
 * circular import.
 *
 *   Index 0   — the gatekeeper. Nobody downstream can act until they do.
 *               If they reject, the request is immediately and finally rejected.
 *   Index 1+  — a parallel tier, unlocked only once the gatekeeper approves.
 *               ALL of them must approve for the request to become approved.
 *               If one of them rejects while the request is still active,
 *               status stays 'pending' — this is a conflict state, not an
 *               auto-rejection, and only Admin can resolve it via actOnBehalf.
 */

// Spec Part 5.2
export function computeLeaveStatus(requiredApproverIds, approvedByIds, rejectedByIds) {
  if (requiredApproverIds.length === 0) return 'approved';
  const [gatekeeperId, ...restIds] = requiredApproverIds.map(String);
  const approved = approvedByIds.map(String);
  const rejected = rejectedByIds.map(String);

  if (rejected.includes(gatekeeperId)) return 'rejected';
  if (!approved.includes(gatekeeperId)) return 'pending';
  if (restIds.length === 0) return 'approved';

  return restIds.every((id) => approved.includes(id)) ? 'approved' : 'pending';
}

// Spec Part 5.5
export function getCurrentTurnApproverIds(request) {
  if (request.status !== 'pending') return [];
  // Admin-only requests have no named approvers — the concept of a turn does
  // not apply to them (see isAwaitingAdminDecision).
  if (request.isAdminOnlyDecision) return [];
  const required = (request.requiredApproverIds || []).map(String);
  if (required.length === 0) return [];
  const approved = (request.approvedByIds || []).map(String);
  const rejected = (request.rejectedByIds || []).map(String);
  const [gatekeeperId, ...restIds] = required;

  if (!approved.includes(gatekeeperId) && !rejected.includes(gatekeeperId)) return [gatekeeperId];
  return restIds.filter((id) => !approved.includes(id) && !rejected.includes(id));
}

export function isCurrentTurnApprover(request, userId) {
  return getCurrentTurnApproverIds(request).includes(String(userId));
}

/**
 * ADDENDUM 2.1 — for an admin-only request there is no chain and no "turn":
 * any active Admin may decide it at any time while it is pending.
 */
export function isAwaitingAdminDecision(request) {
  return Boolean(request.isAdminOnlyDecision) && request.status === 'pending';
}

export function isRequiredApprover(request, userId) {
  return (request.requiredApproverIds || []).map(String).includes(String(userId));
}
