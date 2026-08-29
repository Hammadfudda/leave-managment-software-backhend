import mongoose from 'mongoose';

import LeaveRequest from '../models/LeaveRequest.js';
import Department from '../models/Department.js';
import User from '../models/User.js';

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  audit,
} from '../utils/audit.js';

import {
  calcWorkingDays,
} from '../utils/dates.js';

import {
  deductLeaveBalance,
  restoreLeaveBalance,
} from './balance.service.js';

import {
  notifyNextStep,
} from './notification.service.js';

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
 * Existing stop-request effect.
 * Shortens the original leave and restores the unused balance.
 */
export async function applyStopEffect(
  stopRequest
) {
  const original =
    await LeaveRequest.findById(
      stopRequest.originalRequestId
    );

  if (!original) {
    return;
  }

  const department =
    await Department.findOne({
      name:
        original.department,
    });

  const saturdayOff =
    department?.saturdayOff ??
    true;

  const daysActuallyUsed =
    calcWorkingDays(
      original.startDate,
      stopRequest.endDate,
      saturdayOff
    );

  const currentlyCharged =
    original.daysUsedBeforeCancel ??
    original.totalWorkingDays;

  const daysRestored =
    Math.max(
      0,
      Number(
        currentlyCharged
      ) -
        Number(
          daysActuallyUsed
        )
    );

  original.actualEndDate =
    stopRequest.endDate;

  original.daysUsedBeforeCancel =
    daysActuallyUsed;

  original.cancelledBy =
    stopRequest.employeeId;

  original.cancelledByName =
    stopRequest.employeeName;

  original.cancelledReason =
    stopRequest.reason;

  await original.save();

  if (
    daysRestored >
    0
  ) {
    await restoreLeaveBalance(
      original.employeeId,
      original.leaveType,
      daysRestored,
      null,
      {
        referenceDate:
          original.startDate,
      }
    );
  }
}

/**
 * What an approved request does depends on request type.
 */
export async function applyApprovalEffect(
  request
) {
  if (
    request.isStopRequest &&
    request.originalRequestId
  ) {
    await applyStopEffect(
      request
    );
  } else if (
    request.isExtension
  ) {
    await deductLeaveBalance(
      request.employeeId,
      request.leaveType,
      request.totalWorkingDays,
      null,
      {
        referenceDate:
          request.startDate,
      }
    );
  } else if (
    request.totalWorkingDays >
    0
  ) {
    await deductLeaveBalance(
      request.employeeId,
      request.leaveType,
      request.totalWorkingDays,
      null,
      {
        referenceDate:
          request.startDate,
      }
    );
  }
}

/**
 * Existing Admin-only decision branch.
 */
async function decideAsAdmin(
  request,
  approver,
  action,
  comment
) {
  if (
    !request.isAdminOnlyDecision
  ) {
    return null;
  }

  if (
    approver.role !==
    'admin'
  ) {
    throw new ForbiddenError(
      'Only an Admin can decide this leave type.'
    );
  }

  request.status =
    action;

  request.approvalHistory.push({
    approverId:
      approver._id,
    approverName:
      approver.fullName,
    approverRole:
      approver.role,
    action,
    comment,
  });

  await request.save();

  if (
    action ===
    'approved'
  ) {
    await applyApprovalEffect(
      request
    );
  }

  await notifyNextStep(
    request,
    action,
    comment
  );

  await audit({
    actorId:
      approver._id,
    actorName:
      approver.fullName,
    action:
      action ===
      'approved'
        ? 'APPROVE_LEAVE'
        : 'REJECT_LEAVE',
    targetType:
      'LeaveRequest',
    targetId:
      request._id,
    affectedPerson:
      request.employeeName,
    department:
      request.department,
    leaveType:
      request.leaveType,
    details:
      'Admin-only leave type — decided directly by Admin',
    comment,
  });

  return request;
}

/** Existing normal approval flow. */
export async function approveLeave(
  requestId,
  approver,
  comment
) {
  const request =
    await LeaveRequest.findById(
      requestId
    );

  if (!request) {
    throw new NotFoundError();
  }

  if (
    String(
      request.employeeId
    ) ===
    String(
      approver._id
    )
  ) {
    throw new ForbiddenError(
      'You cannot approve your own leave request.'
    );
  }

  if (
    request.status !==
    'pending'
  ) {
    throw new ForbiddenError(
      'This request has already been finalized.'
    );
  }

  const adminDecided =
    await decideAsAdmin(
      request,
      approver,
      'approved',
      comment
    );

  if (adminDecided) {
    return adminDecided;
  }

  if (
    !isCurrentTurnApprover(
      request,
      approver._id
    )
  ) {
    if (
      !isRequiredApprover(
        request,
        approver._id
      )
    ) {
      throw new NotFoundError();
    }

    throw new ForbiddenError(
      'It is not your turn to act on this request yet.'
    );
  }

  const approvedByIds = [
    ...new Set([
      ...request.approvedByIds.map(
        String
      ),
      String(
        approver._id
      ),
    ]),
  ];

  const newStatus =
    computeLeaveStatus(
      request.requiredApproverIds,
      approvedByIds,
      request.rejectedByIds
    );

  request.approvedByIds =
    approvedByIds;

  request.status =
    newStatus;

  request.approvalHistory.push({
    approverId:
      approver._id,
    approverName:
      approver.fullName,
    approverRole:
      approver.role,
    action:
      'approved',
    comment,
  });

  await request.save();

  if (
    newStatus ===
    'approved'
  ) {
    await applyApprovalEffect(
      request
    );
  }

  await notifyNextStep(
    request,
    newStatus,
    comment
  );

  await audit({
    actorId:
      approver._id,
    actorName:
      approver.fullName,
    action:
      'APPROVE_LEAVE',
    targetType:
      'LeaveRequest',
    targetId:
      request._id,
    affectedPerson:
      request.employeeName,
    department:
      request.department,
    leaveType:
      request.leaveType,
    comment,
  });

  return request;
}

/** Existing normal rejection flow. */
export async function rejectLeave(
  requestId,
  approver,
  comment
) {
  const request =
    await LeaveRequest.findById(
      requestId
    );

  if (!request) {
    throw new NotFoundError();
  }

  if (
    String(
      request.employeeId
    ) ===
    String(
      approver._id
    )
  ) {
    throw new ForbiddenError(
      'You cannot reject your own leave request.'
    );
  }

  if (
    request.status !==
    'pending'
  ) {
    throw new ForbiddenError(
      'This request has already been finalized.'
    );
  }

  const adminDecided =
    await decideAsAdmin(
      request,
      approver,
      'rejected',
      comment
    );

  if (adminDecided) {
    return adminDecided;
  }

  if (
    !isCurrentTurnApprover(
      request,
      approver._id
    )
  ) {
    if (
      !isRequiredApprover(
        request,
        approver._id
      )
    ) {
      throw new NotFoundError();
    }

    throw new ForbiddenError(
      'It is not your turn to act on this request yet.'
    );
  }

  const rejectedByIds = [
    ...new Set([
      ...request.rejectedByIds.map(
        String
      ),
      String(
        approver._id
      ),
    ]),
  ];

  const newStatus =
    computeLeaveStatus(
      request.requiredApproverIds,
      request.approvedByIds,
      rejectedByIds
    );

  request.rejectedByIds =
    rejectedByIds;

  request.status =
    newStatus;

  request.approvalHistory.push({
    approverId:
      approver._id,
    approverName:
      approver.fullName,
    approverRole:
      approver.role,
    action:
      'rejected',
    comment,
  });

  await request.save();

  await notifyNextStep(
    request,
    newStatus,
    comment
  );

  await audit({
    actorId:
      approver._id,
    actorName:
      approver.fullName,
    action:
      'REJECT_LEAVE',
    targetType:
      'LeaveRequest',
    targetId:
      request._id,
    affectedPerson:
      request.employeeName,
    department:
      request.department,
    leaveType:
      request.leaveType,
    comment,
  });

  return request;
}

/**
 * Existing Admin on-behalf flow.
 * Admin fills one approver slot only; it does not skip the chain.
 */
export async function actOnBehalf(
  requestId,
  admin,
  targetApproverId,
  action,
  comment
) {
  const request =
    await LeaveRequest.findById(
      requestId
    );

  if (!request) {
    throw new NotFoundError();
  }

  if (
    request.isAdminOnlyDecision
  ) {
    throw new ForbiddenError(
      'This leave type is decided directly by Admin — use approve or reject instead.'
    );
  }

  const targetApprover =
    await User.findById(
      targetApproverId
    );

  if (!targetApprover) {
    throw new NotFoundError();
  }

  if (
    String(
      request.employeeId
    ) ===
    String(
      targetApproverId
    )
  ) {
    throw new ForbiddenError(
      'Cannot act on behalf of the employee for their own request.'
    );
  }

  if (
    !isRequiredApprover(
      request,
      targetApproverId
    )
  ) {
    throw new ForbiddenError(
      'That person is not a required approver on this request.'
    );
  }

  if (
    request.status !==
    'pending'
  ) {
    throw new ForbiddenError(
      'This request has already been finalized.'
    );
  }

  const approvedByIds =
    action ===
    'approved'
      ? [
          ...new Set([
            ...request.approvedByIds.map(
              String
            ),
            String(
              targetApproverId
            ),
          ]),
        ]
      : request.approvedByIds;

  const rejectedByIds =
    action ===
    'rejected'
      ? [
          ...new Set([
            ...request.rejectedByIds.map(
              String
            ),
            String(
              targetApproverId
            ),
          ]),
        ]
      : request.rejectedByIds;

  const newStatus =
    computeLeaveStatus(
      request.requiredApproverIds,
      approvedByIds,
      rejectedByIds
    );

  request.approvedByIds =
    approvedByIds;

  request.rejectedByIds =
    rejectedByIds;

  request.status =
    newStatus;

  request.approvalHistory.push({
    approverId:
      targetApproverId,
    approverName:
      targetApprover.fullName,
    approverRole:
      targetApprover.role,
    action,
    comment:
      `${comment ? `${comment} — ` : ''}${
        action ===
        'approved'
          ? 'Approved'
          : 'Rejected'
      } by Admin on behalf of ${targetApprover.fullName}`,
  });

  await request.save();

  if (
    newStatus ===
    'approved'
  ) {
    await applyApprovalEffect(
      request
    );
  }

  await notifyNextStep(
    request,
    newStatus,
    comment
  );

  await audit({
    actorId:
      admin._id,
    actorName:
      admin.fullName,
    action:
      action ===
      'approved'
        ? 'APPROVE_LEAVE'
        : 'REJECT_LEAVE',
    targetType:
      'LeaveRequest',
    targetId:
      request._id,
    affectedPerson:
      request.employeeName,
    department:
      request.department,
    leaveType:
      request.leaveType,
    details:
      `Admin ${action} on behalf of ${targetApprover.fullName}`,
    comment,
  });

  return request;
}

/**
 * New confirmed rule:
 * Admin may override a finalized Manager/final-approver decision.
 * Original approvalHistory is append-only.
 */
export async function overrideFinalDecision(
  requestId,
  admin,
  action,
  reason
) {
  if (
    admin.role !==
    'admin'
  ) {
    throw new ForbiddenError(
      'Only an Admin can override a finalized leave decision.'
    );
  }

  const cleanReason =
    String(
      reason ||
      ''
    ).trim();

  if (!cleanReason) {
    throw new ValidationError(
      'A reason is required for an Admin override.'
    );
  }

  if (
    ![
      'approved',
      'rejected',
    ].includes(
      action
    )
  ) {
    throw new ValidationError(
      'Override action must be approved or rejected.'
    );
  }

  const session =
    await mongoose.startSession();

  let savedRequest =
    null;

  try {
    await session.withTransaction(
      async () => {
        const request =
          await LeaveRequest.findById(
            requestId
          ).session(
            session
          );

        if (!request) {
          throw new NotFoundError();
        }

        if (
          ![
            'approved',
            'rejected',
          ].includes(
            request.status
          )
        ) {
          throw new ValidationError(
            'Only an approved or rejected finalized decision can be overridden.'
          );
        }

        if (
          request.isStopRequest
        ) {
          throw new ValidationError(
            'A finalized stop-request is not overridden here. Select the original leave.'
          );
        }

        if (
          request.status ===
          action
        ) {
          throw new ValidationError(
            `The leave request is already ${action}.`
          );
        }

        const previousStatus =
          request.status;

        /*
         * If this leave was already shortened, only the amount still charged
         * to the balance is reversed. This prevents double restoration.
         */
        const currentlyCharged =
          request.daysUsedBeforeCancel ??
          request.totalWorkingDays;

        if (
          previousStatus ===
            'approved' &&
          action ===
            'rejected' &&
          Number(
            currentlyCharged
          ) >
            0
        ) {
          await restoreLeaveBalance(
            request.employeeId,
            request.leaveType,
            Number(
              currentlyCharged
            ),
            null,
            {
              session,
              referenceDate:
                request.startDate,
            }
          );
        }

        if (
          previousStatus ===
            'rejected' &&
          action ===
            'approved'
        ) {
          await deductLeaveBalance(
            request.employeeId,
            request.leaveType,
            Number(
              request.daysUsedBeforeCancel ??
              request.totalWorkingDays
            ),
            null,
            {
              session,
              referenceDate:
                request.startDate,
            }
          );
        }

        request.status =
          action;

        request.approvalHistory.push({
          approverId:
            admin._id,
          approverName:
            admin.fullName,
          approverRole:
            'admin',
          action,
          comment:
            cleanReason,
          isAdminOverride:
            true,
          previousStatus,
          newStatus:
            action,
        });

        await request.save({
          session,
        });

        await audit(
          {
            actorId:
              admin._id,
            actorName:
              admin.fullName,
            action:
              'ADMIN_OVERRIDE_LEAVE',
            targetType:
              'LeaveRequest',
            targetId:
              request._id,
            affectedPerson:
              request.employeeName,
            department:
              request.department,
            leaveType:
              request.leaveType,
            details:
              `Admin changed finalized leave decision from ${previousStatus} to ${action}. Original approval history was preserved.`,
            comment:
              cleanReason,
          },
          {
            session,
          }
        );

        savedRequest =
          request;
      }
    );
  } finally {
    await session.endSession();
  }

  if (
    savedRequest
  ) {
    await notifyNextStep(
      savedRequest,
      action,
      cleanReason
    );
  }

  return savedRequest;
}

/**
 * New confirmed rule:
 * Admin can directly stop an active approved leave.
 * Status remains approved; actualEndDate and daysUsedBeforeCancel store
 * what was actually used.
 */
export async function adminStopApprovedLeave(
  requestId,
  admin,
  effectiveReturnDate,
  reason
) {
  if (
    admin.role !==
    'admin'
  ) {
    throw new ForbiddenError(
      'Only an Admin can stop an approved leave directly.'
    );
  }

  const cleanReason =
    String(
      reason ||
      ''
    ).trim();

  if (!cleanReason) {
    throw new ValidationError(
      'A reason is required to stop the leave.'
    );
  }

  const returnDate =
    new Date(
      effectiveReturnDate
    );

  if (
    Number.isNaN(
      returnDate.getTime()
    )
  ) {
    throw new ValidationError(
      'A valid Effective Return / Join Date is required.'
    );
  }

  const session =
    await mongoose.startSession();

  let savedRequest =
    null;

  try {
    await session.withTransaction(
      async () => {
        const request =
          await LeaveRequest.findById(
            requestId
          ).session(
            session
          );

        if (!request) {
          throw new NotFoundError();
        }

        if (
          request.status !==
          'approved'
        ) {
          throw new ValidationError(
            'Only an approved leave can be stopped.'
          );
        }

        if (
          request.isStopRequest
        ) {
          throw new ValidationError(
            'Select the original approved leave, not its stop-request.'
          );
        }

        const start =
          new Date(
            request.startDate
          );

        const currentEnd =
          new Date(
            request.actualEndDate ||
            request.endDate
          );

        if (
          returnDate <
            start ||
          returnDate >
            currentEnd
        ) {
          throw new ValidationError(
            'Effective Return / Join Date must fall inside the currently approved leave period.'
          );
        }

        const today =
          new Date();

        today.setHours(
          0,
          0,
          0,
          0
        );

        const startDay =
          new Date(
            start
          );

        startDay.setHours(
          0,
          0,
          0,
          0
        );

        const endDay =
          new Date(
            currentEnd
          );

        endDay.setHours(
          23,
          59,
          59,
          999
        );

        if (
          today <
            startDay ||
          today >
            endDay
        ) {
          throw new ValidationError(
            'Admin Stop Leave is available only while the approved leave is active.'
          );
        }

        const department =
          await Department.findOne({
            name:
              request.department,
          }).session(
            session
          );

        const saturdayOff =
          department?.saturdayOff ??
          true;

        /*
         * Effective Return / Join Date is the first day back at work.
         * Therefore it is NOT counted as a leave day.
         */
        const lastLeaveDay =
          new Date(
            returnDate
          );

        lastLeaveDay.setUTCDate(
          lastLeaveDay.getUTCDate() -
          1
        );

        const daysActuallyUsed =
          lastLeaveDay < start
            ? 0
            : calcWorkingDays(
                start,
                lastLeaveDay,
                saturdayOff
              );

        const currentlyCharged =
          request.daysUsedBeforeCancel ??
          request.totalWorkingDays;

        const daysRestored =
          Math.max(
            0,
            Number(
              currentlyCharged
            ) -
              Number(
                daysActuallyUsed
              )
          );

        if (
          daysRestored >
          0
        ) {
          await restoreLeaveBalance(
            request.employeeId,
            request.leaveType,
            daysRestored,
            null,
            {
              session,
              referenceDate:
                request.startDate,
            }
          );
        }

        request.actualEndDate =
          lastLeaveDay;

        request.daysUsedBeforeCancel =
          daysActuallyUsed;

        request.cancelledBy =
          admin._id;

        request.cancelledByName =
          admin.fullName;

        request.cancelledReason =
          cleanReason;

        request.approvalHistory.push({
          approverId:
            admin._id,
          approverName:
            admin.fullName,
          approverRole:
            'admin',
          action:
            'cancelled',
          comment:
            cleanReason,
          isAdminStop:
            true,
          effectiveReturnDate:
            returnDate,
          previousStatus:
            'approved',
          newStatus:
            'approved',
        });

        await request.save({
          session,
        });

        await audit(
          {
            actorId:
              admin._id,
            actorName:
              admin.fullName,
            action:
              'ADMIN_STOP_LEAVE',
            targetType:
              'LeaveRequest',
            targetId:
              request._id,
            affectedPerson:
              request.employeeName,
            department:
              request.department,
            leaveType:
              request.leaveType,
            details:
              `Admin shortened approved leave effective ${returnDate
                .toISOString()
                .slice(
                  0,
                  10
                )}. ${daysRestored} unused working day(s) restored.`,
            comment:
              cleanReason,
          },
          {
            session,
          }
        );

        savedRequest =
          request;
      }
    );
  } finally {
    await session.endSession();
  }

  return savedRequest;
}
