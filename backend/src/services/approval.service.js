import LeaveRequest from '../models/LeaveRequest.js';
import Department from '../models/Department.js';
import User from '../models/User.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { calcWorkingDays } from '../utils/dates.js';
import { deductLeaveBalance, restoreLeaveBalance } from './balance.service.js';
import { notifyNextStep } from './notification.service.js';
import {
  computeLeaveStatus,
  isAwaitingAdminDecision,
  getCurrentTurnApproverIds,
  isCurrentTurnApprover,
  isRequiredApprover,
} from './approvalChain.js';

export {
  computeLeaveStatus,
  isAwaitingAdminDecision,
  getCurrentTurnApproverIds,
  isCurrentTurnApprover,
  isRequiredApprover,
};

/**
 * Spec Part 7.2 — applied only once the stop-request itself is approved.
 * Shortens the original leave and restores the unused balance.
 */
export async function applyStopEffect(stopRequest) {
  const original = await LeaveRequest.findById(stopRequest.originalRequestId);
  if (!original) return;
  const department = await Department.findOne({ name: original.department });
  const saturdayOff = department?.saturdayOff ?? true;

  const daysActuallyUsed = calcWorkingDays(original.startDate, stopRequest.endDate, saturdayOff);
  const daysRestored = Math.max(0, original.totalWorkingDays - daysActuallyUsed);

  original.actualEndDate = stopRequest.endDate;
  original.daysUsedBeforeCancel = daysActuallyUsed;
  original.cancelledBy = stopRequest.employeeId;
  original.cancelledByName = stopRequest.employeeName;
  original.cancelledReason = stopRequest.reason;
  await original.save();

  if (daysRestored > 0) {
    await restoreLeaveBalance(original.employeeId, original.leaveType, daysRestored);
  }
}

/**
 * Spec Part 5.4 — what "approved" actually does differs by request type.
 * Note the asymmetry: a stop-request's own totalWorkingDays is 0. It doesn't
 * consume balance itself; its purpose is to reduce what the original consumed.
 */
export async function applyApprovalEffect(request) {
  if (request.isStopRequest && request.originalRequestId) {
    await applyStopEffect(request);
  } else if (request.isExtension) {
    await deductLeaveBalance(request.employeeId, request.leaveType, request.totalWorkingDays);
  } else if (request.totalWorkingDays > 0) {
    await deductLeaveBalance(request.employeeId, request.leaveType, request.totalWorkingDays);
  }
}


/**
 * ADDENDUM 2.1 — the admin-only decision branch, shared by approve and reject.
 * An empty requiredApproverIds array must NOT auto-approve here: the request
 * waits until an Admin explicitly decides it. Returns the saved request, or
 * null when this request is not an admin-only one (fall through to the chain).
 */
async function decideAsAdmin(request, approver, action, comment) {
  if (!request.isAdminOnlyDecision) return null;
  if (approver.role !== 'admin') {
    throw new ForbiddenError('Only an Admin can decide this leave type.');
  }
  request.status = action;
  request.approvalHistory.push({
    approverId: approver._id,
    approverName: approver.fullName,
    approverRole: approver.role,
    action,
    comment,
  });
  await request.save();
  if (action === 'approved') await applyApprovalEffect(request);
  await notifyNextStep(request, action, comment);
  await audit({
    actorId: approver._id,
    actorName: approver.fullName,
    action: action === 'approved' ? 'APPROVE_LEAVE' : 'REJECT_LEAVE',
    targetType: 'LeaveRequest',
    targetId: request._id,
    affectedPerson: request.employeeName,
    department: request.department,
    leaveType: request.leaveType,
    details: 'Admin-only leave type — decided directly by Admin',
    comment,
  });
  return request;
}

/** Spec Part 5.2 */
export async function approveLeave(requestId, approver, comment) {
  const request = await LeaveRequest.findById(requestId);
  if (!request) throw new NotFoundError();

  // RULE: nobody approves their own leave. Not even Admin. No exceptions.
  if (String(request.employeeId) === String(approver._id)) {
    throw new ForbiddenError('You cannot approve your own leave request.');
  }
  if (request.status !== 'pending') {
    throw new ForbiddenError('This request has already been finalized.');
  }

  const adminDecided = await decideAsAdmin(request, approver, 'approved', comment);
  if (adminDecided) return adminDecided;

  // Part 5.5 — enforced server-side, not just in the UI.
  if (!isCurrentTurnApprover(request, approver._id)) {
    // A required approver whose turn hasn't come yet gets a clear 403; anyone
    // who isn't in the chain at all gets a 404 (Part 9.2) from the controller.
    if (!isRequiredApprover(request, approver._id)) throw new NotFoundError();
    throw new ForbiddenError('It is not your turn to act on this request yet.');
  }

  const approvedByIds = [
    ...new Set([...request.approvedByIds.map(String), String(approver._id)]),
  ];

  const newStatus = computeLeaveStatus(
    request.requiredApproverIds,
    approvedByIds,
    request.rejectedByIds
  );

  request.approvedByIds = approvedByIds;
  request.status = newStatus;
  request.approvalHistory.push({
    approverId: approver._id,
    approverName: approver.fullName,
    approverRole: approver.role,
    action: 'approved',
    comment,
  });
  await request.save();

  if (newStatus === 'approved') {
    await applyApprovalEffect(request);
  }

  await notifyNextStep(request, newStatus, comment);
  await audit({
    actorId: approver._id,
    actorName: approver.fullName,
    action: 'APPROVE_LEAVE',
    targetType: 'LeaveRequest',
    targetId: request._id,
    affectedPerson: request.employeeName,
    department: request.department,
    leaveType: request.leaveType,
    comment,
  });
  return request;
}

/** Mirrors approveLeave exactly, writing to rejectedByIds instead. */
export async function rejectLeave(requestId, approver, comment) {
  const request = await LeaveRequest.findById(requestId);
  if (!request) throw new NotFoundError();

  if (String(request.employeeId) === String(approver._id)) {
    throw new ForbiddenError('You cannot reject your own leave request.');
  }
  if (request.status !== 'pending') {
    throw new ForbiddenError('This request has already been finalized.');
  }

  const adminDecided = await decideAsAdmin(request, approver, 'rejected', comment);
  if (adminDecided) return adminDecided;

  if (!isCurrentTurnApprover(request, approver._id)) {
    if (!isRequiredApprover(request, approver._id)) throw new NotFoundError();
    throw new ForbiddenError('It is not your turn to act on this request yet.');
  }

  const rejectedByIds = [
    ...new Set([...request.rejectedByIds.map(String), String(approver._id)]),
  ];

  const newStatus = computeLeaveStatus(
    request.requiredApproverIds,
    request.approvedByIds,
    rejectedByIds
  );

  request.rejectedByIds = rejectedByIds;
  request.status = newStatus;
  request.approvalHistory.push({
    approverId: approver._id,
    approverName: approver.fullName,
    approverRole: approver.role,
    action: 'rejected',
    comment,
  });
  await request.save();

  await notifyNextStep(request, newStatus, comment);
  await audit({
    actorId: approver._id,
    actorName: approver.fullName,
    action: 'REJECT_LEAVE',
    targetType: 'LeaveRequest',
    targetId: request._id,
    affectedPerson: request.employeeName,
    department: request.department,
    leaveType: request.leaveType,
    comment,
  });
  return request;
}

/**
 * Spec Part 5.3 — Admin override. Admin fills ONE specific person's slot only;
 * the chain still proceeds normally to whoever's next, it is not skipped.
 *
 * There is deliberately no endpoint that force-approves an entire chain in one
 * call, none that lets Admin initiate a stop or extension on an employee's
 * behalf, and none that lets anyone approve their own request.
 */
export async function actOnBehalf(requestId, admin, targetApproverId, action, comment) {
  const request = await LeaveRequest.findById(requestId);
  if (!request) throw new NotFoundError();
  // ADDENDUM 2.1 — there is no slot to fill on an admin-only request; Admin
  // uses the plain approve/reject endpoints for those.
  if (request.isAdminOnlyDecision) {
    throw new ForbiddenError(
      'This leave type is decided directly by Admin — use approve or reject instead.'
    );
  }
  const targetApprover = await User.findById(targetApproverId);
  if (!targetApprover) throw new NotFoundError();

  if (String(request.employeeId) === String(targetApproverId)) {
    throw new ForbiddenError('Cannot act on behalf of the employee for their own request.');
  }
  if (!isRequiredApprover(request, targetApproverId)) {
    throw new ForbiddenError('That person is not a required approver on this request.');
  }
  if (request.status !== 'pending') {
    throw new ForbiddenError('This request has already been finalized.');
  }

  const approvedByIds =
    action === 'approved'
      ? [...new Set([...request.approvedByIds.map(String), String(targetApproverId)])]
      : request.approvedByIds;
  const rejectedByIds =
    action === 'rejected'
      ? [...new Set([...request.rejectedByIds.map(String), String(targetApproverId)])]
      : request.rejectedByIds;

  const newStatus = computeLeaveStatus(request.requiredApproverIds, approvedByIds, rejectedByIds);

  request.approvedByIds = approvedByIds;
  request.rejectedByIds = rejectedByIds;
  request.status = newStatus;
  request.approvalHistory.push({
    approverId: targetApproverId,
    approverName: targetApprover.fullName,
    approverRole: targetApprover.role,
    action,
    comment: `${comment ? comment + ' — ' : ''}${
      action === 'approved' ? 'Approved' : 'Rejected'
    } by Admin on behalf of ${targetApprover.fullName}`,
  });
  await request.save();

  if (newStatus === 'approved') await applyApprovalEffect(request);

  await notifyNextStep(request, newStatus, comment);
  await audit({
    actorId: admin._id,
    actorName: admin.fullName,
    action: action === 'approved' ? 'APPROVE_LEAVE' : 'REJECT_LEAVE',
    targetType: 'LeaveRequest',
    targetId: request._id,
    affectedPerson: request.employeeName,
    department: request.department,
    leaveType: request.leaveType,
    details: `Admin ${action} on behalf of ${targetApprover.fullName}`,
    comment,
  });
  return request;
}
