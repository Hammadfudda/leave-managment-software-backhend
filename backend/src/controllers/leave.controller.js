import LeaveRequest from '../models/LeaveRequest.js';
import LeavePolicy from '../models/LeavePolicy.js';
import Department from '../models/Department.js';
import User from '../models/User.js';

import cloudinary from '../config/cloudinary.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  audit,
} from '../utils/audit.js';

import {
  getPagination,
  paginated,
} from '../utils/pagination.js';

import {
  calcCalendarDays,
  calcWorkingDays,
  getExcludedWeekendDates,
} from '../utils/dates.js';

import {
  getLeaveBalancesForUser,
} from '../services/balance.service.js';

import {
  checkApplicantScope,
  getAvailableLeaveTypesForUser,
} from '../services/eligibility.service.js';

import {
  notifyGatekeeper,
} from '../services/notification.service.js';

import {
  actOnBehalf,
  approveLeave,
  getCurrentTurnApproverIds,
  isAwaitingAdminDecision,
  isRequiredApprover,
  rejectLeave,
} from '../services/approval.service.js';

const ATTACHMENT_URL_TTL_SECONDS =
  10 * 60;

/* =========================================================
   POLICY RESOLUTION
========================================================= */

async function resolvePolicy(
  leaveType,
  user
) {
  const candidates =
    await LeavePolicy.find({
      leaveType,
    });

  if (
    candidates.length === 0
  ) {
    throw new ValidationError(
      `No leave policy is configured for "${leaveType}".`
    );
  }

  const scoped =
    candidates.filter(
      (policy) =>
        checkApplicantScope(
          policy,
          user
        ) === null
    );

  if (
    scoped.length === 0
  ) {
    throw new ForbiddenError(
      checkApplicantScope(
        candidates[0],
        user
      ) ||
        'This leave type is not available to you.'
    );
  }

  const score = (
    policy
  ) =>
    (
      policy
        .approvalRouting
        ?.grade
        ? 4
        : 0
    ) +
    (
      policy
        .approvalRouting
        ?.department
        ? 2
        : 0
    ) +
    (
      policy
        .approvalRouting
        ?.designation
        ? 1
        : 0
    );

  return scoped.sort(
    (a, b) =>
      score(b) -
      score(a)
  )[0];
}

/* =========================================================
   APPROVAL CHAIN
========================================================= */

async function resolveChainFor(
  policy,
  user
) {
  if (
    policy.adminOnlyApproval
  ) {
    return {
      requiredApproverIds:
        [],

      isAdminOnlyDecision:
        true,
    };
  }

  if (
    policy.finalApprovalMode
  ) {
    const noManagerMessage =
      'No active Manager is assigned to this employee. Please contact an administrator.';

    if (
      !user.managerId
    ) {
      throw new ValidationError(
        noManagerMessage
      );
    }

    const manager =
      await User.findById(
        user.managerId
      );

    if (
      !manager ||
      manager.role !==
        'manager' ||
      manager.status !==
        'active'
    ) {
      throw new ValidationError(
        noManagerMessage
      );
    }

    if (
      String(
        manager._id
      ) ===
      String(
        user._id
      )
    ) {
      throw new ValidationError(
        noManagerMessage
      );
    }

    return {
      requiredApproverIds:
        [
          manager._id,
        ],

      isAdminOnlyDecision:
        false,
    };
  }

  return {
    requiredApproverIds:
      policy
        .approvalRouting
        ?.approverIds ||
      [],

    isAdminOnlyDecision:
      false,
  };
}

/* =========================================================
   SATURDAY RULE
========================================================= */

async function saturdayOffFor(
  departmentName
) {
  const department =
    await Department.findOne({
      name:
        departmentName,
    });

  return (
    department
      ?.saturdayOff ??
    true
  );
}

/* =========================================================
   RESPONSE DECORATOR

   IMPORTANT:
   permanent Cloudinary URL expose nahi hoti.
========================================================= */

function decorate(
  request,
  viewer
) {
  const obj =
    request.toObject
      ? request.toObject()
      : {
          ...request,
        };

  const viewerId =
    viewer?._id ??
    viewer;

  const viewerRole =
    viewer?.role;

  const turnIds =
    getCurrentTurnApproverIds(
      request
    );

  const awaitingAdmin =
    isAwaitingAdminDecision(
      request
    );

  delete obj.attachmentUrl;

  return {
    ...obj,

    hasAttachment:
      Boolean(
        obj.attachmentPublicId
      ),

    currentTurnApproverIds:
      turnIds,

    awaitingAdminDecision:
      awaitingAdmin,

    isMyTurn:
      awaitingAdmin
        ? (
            viewerRole ===
              'admin' &&
            String(
              viewerId
            ) !==
              String(
                request.employeeId
              )
          )
        : viewerId
          ? turnIds.includes(
              String(
                viewerId
              )
            )
          : false,
  };
}

/* =========================================================
   ROLE BASED LIST SCOPE
========================================================= */

function scopeFor(
  user
) {
  if (
    user.role ===
    'admin'
  ) {
    return {};
  }

  if (
    user.role ===
    'manager'
  ) {
    return {
      $or: [
        {
          employeeId:
            user._id,
        },

        {
          requiredApproverIds:
            user._id,
        },
      ],
    };
  }

  return {
    employeeId:
      user._id,
  };
}

/* =========================================================
   REQUEST ACCESS
========================================================= */

function canViewRequest(
  request,
  user
) {
  const isOwner =
    String(
      request.employeeId
    ) ===
    String(
      user._id
    );

  return (
    user.role ===
      'admin' ||
    isOwner ||
    isRequiredApprover(
      request,
      user._id
    )
  );
}

/* =========================================================
   PRIVATE CLOUDINARY UPLOAD
========================================================= */

function uploadPrivateAttachment(
  file
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {
      const isPdf =
        file.mimetype ===
        'application/pdf';

      const stream =
        cloudinary
          .uploader
          .upload_stream(
            {
              folder:
                'leave-management/attachments',

              type:
                'private',

              resource_type:
                isPdf
                  ? 'raw'
                  : 'image',

              use_filename:
                false,

              unique_filename:
                true,

              overwrite:
                false,
            },

            (
              error,
              result
            ) => {
              if (
                error
              ) {
                reject(
                  error
                );

                return;
              }

              resolve(
                result
              );
            }
          );

      stream.end(
        file.buffer
      );
    }
  );
}

/* =========================================================
   CLOUDINARY CLEANUP
========================================================= */

async function deletePrivateAttachment(
  attachment
) {
  if (
    !attachment
      ?.public_id
  ) {
    return;
  }

  try {
    await cloudinary
      .uploader
      .destroy(
        attachment.public_id,
        {
          resource_type:
            attachment
              .resource_type ||
            'image',

          type:
            'private',

          invalidate:
            true,
        }
      );
  } catch (
    error
  ) {
    console.error(
      'Cloudinary cleanup failed:',
      error
    );
  }
}

/* =========================================================
   LIST LEAVE REQUESTS
========================================================= */

export const listLeaveRequests =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const filter = {
        ...scopeFor(
          req.currentUser
        ),
      };

      if (
        req.query
          .status
      ) {
        filter.status =
          req.query.status;
      }

      if (
        req.query
          .leaveType
      ) {
        filter.leaveType =
          req.query.leaveType;
      }

      if (
        req.query
          .department
      ) {
        filter.department =
          req.query.department;
      }

      if (
        req.query
          .employeeName
      ) {
        filter.employeeName =
          {
            $regex:
              String(
                req.query
                  .employeeName
              ).trim(),

            $options:
              'i',
          };
      }

      if (
        req.query
          .employeeId
      ) {
        filter.employeeId =
          req.query.employeeId;
      }

      if (
        req.query
          .isExtension !==
        undefined
      ) {
        filter.isExtension =
          req.query
            .isExtension ===
          'true';
      }

      if (
        req.query
          .isStopRequest !==
        undefined
      ) {
        filter.isStopRequest =
          req.query
            .isStopRequest ===
          'true';
      }

      if (
        req.query
          .isAdminOnlyDecision !==
        undefined
      ) {
        filter.isAdminOnlyDecision =
          req.query
            .isAdminOnlyDecision ===
          'true';
      }

      if (
        req.query
          .from ||
        req.query
          .to
      ) {
        filter.startDate =
          {};

        if (
          req.query
            .from
        ) {
          filter
            .startDate
            .$gte =
            new Date(
              req.query
                .from
            );
        }

        if (
          req.query
            .to
        ) {
          filter
            .startDate
            .$lte =
            new Date(
              req.query
                .to
            );
        }
      }

      const pagination =
        getPagination(
          req.query
        );

      const [
        items,
        total,
      ] =
        await Promise.all([
          LeaveRequest.find(
            filter
          )
            .sort({
              createdAt:
                -1,
            })
            .skip(
              pagination.skip
            )
            .limit(
              pagination.limit
            ),

          LeaveRequest.countDocuments(
            filter
          ),
        ]);

      res.json({
        success: true,

        ...paginated(
          items.map(
            (
              request
            ) =>
              decorate(
                request,
                req.currentUser
              )
          ),

          total,

          pagination
        ),
      });
    }
  );

/* =========================================================
   GET SINGLE LEAVE
========================================================= */

export const getLeaveRequest =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const request =
        await LeaveRequest.findById(
          req.params.id
        );

      if (
        !request
      ) {
        throw new NotFoundError();
      }

      if (
        !canViewRequest(
          request,
          req.currentUser
        )
      ) {
        throw new NotFoundError();
      }

      res.json({
        success: true,

        data:
          decorate(
            request,
            req.currentUser
          ),
      });
    }
  );

/* =========================================================
   PRIVATE ATTACHMENT TEMPORARY URL
========================================================= */

export const getAttachmentUrl =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const request =
        await LeaveRequest.findById(
          req.params.id
        );

      if (
        !request
      ) {
        throw new NotFoundError();
      }

      if (
        !canViewRequest(
          request,
          req.currentUser
        )
      ) {
        throw new NotFoundError();
      }

      if (
        !request
          .attachmentPublicId
      ) {
        throw new NotFoundError(
          'This leave request has no attachment.'
        );
      }

      const expiresAt =
        Math.floor(
          Date.now() /
            1000
        ) +
        ATTACHMENT_URL_TTL_SECONDS;

      const url =
        cloudinary
          .utils
          .private_download_url(
            request
              .attachmentPublicId,

            request
              .attachmentFormat ||
              '',

            {
              resource_type:
                request
                  .attachmentResourceType ||
                'image',

              type:
                'private',

              expires_at:
                expiresAt,

              attachment:
                false,
            }
          );

      res.json({
        success: true,

        data: {
          url,

          expiresAt,

          expiresInSeconds:
            ATTACHMENT_URL_TTL_SECONDS,

          name:
            request
              .attachmentName ||
            'attachment',
        },
      });
    }
  );

/* =========================================================
   AVAILABLE LEAVE TYPES
========================================================= */

export const listAvailableLeaveTypes =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const types =
        await getAvailableLeaveTypesForUser(
          req.currentUser
        );

      res.json({
        success: true,

        data: [
          ...new Set(
            types
          ),
        ],
      });
    }
  );

/* =========================================================
   CREATE LEAVE REQUEST
========================================================= */

export const createLeaveRequest =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const user =
        req.currentUser;

      const {
        leaveType,
        startDate,
        endDate,
        reason,
      } =
        req.body;

      if (
        !leaveType ||
        !startDate ||
        !endDate ||
        !reason
      ) {
        throw new ValidationError(
          'Leave type, start date, end date and reason are all required.'
        );
      }

      const start =
        new Date(
          startDate
        );

      const end =
        new Date(
          endDate
        );

      if (
        Number.isNaN(
          start.getTime()
        ) ||
        Number.isNaN(
          end.getTime()
        )
      ) {
        throw new ValidationError(
          'Invalid dates supplied.'
        );
      }

      if (
        end <
        start
      ) {
        throw new ValidationError(
          'End date cannot be before the start date.'
        );
      }

      const policy =
        await resolvePolicy(
          leaveType,
          user
        );

      const chain =
        await resolveChainFor(
          policy,
          user
        );

      if (
        policy
          .documentRequirement ===
          'required' &&
        !req.file
      ) {
        throw new ValidationError(
          'A supporting document is required for this leave type.'
        );
      }

      const saturdayOff =
        await saturdayOffFor(
          user.department
        );

      const totalWorkingDays =
        calcWorkingDays(
          start,
          end,
          saturdayOff
        );

      if (
        totalWorkingDays ===
        0
      ) {
        throw new ValidationError(
          'The selected range contains no working days.'
        );
      }

      let uploadedAttachment =
        null;

      try {
        if (
          req.file
        ) {
          uploadedAttachment =
            await uploadPrivateAttachment(
              req.file
            );
        }

        const request =
          await LeaveRequest.create(
            {
              employeeId:
                user._id,

              employeeName:
                user.fullName,

              department:
                user.department,

              leaveType,

              startDate:
                start,

              endDate:
                end,

              totalDaysRequested:
                calcCalendarDays(
                  start,
                  end
                ),

              totalWorkingDays,

              excludedWeekendDates:
                getExcludedWeekendDates(
                  start,
                  end,
                  saturdayOff
                ),

              reason,

              attachmentName:
                req.file
                  ?.originalname,

              attachmentPublicId:
                uploadedAttachment
                  ?.public_id,

              attachmentResourceType:
                uploadedAttachment
                  ?.resource_type,

              attachmentFormat:
                uploadedAttachment
                  ?.format,

              attachmentBytes:
                uploadedAttachment
                  ?.bytes,

              attachmentMimeType:
                req.file
                  ?.mimetype,

              attachmentVersion:
                uploadedAttachment
                  ?.version,

              ...chain,

              approvedByIds:
                [],

              rejectedByIds:
                [],

              status:
                'pending',
            }
          );

        await notifyGatekeeper(
          request,
          'leave_pending_approval'
        );

        await audit({
          actorId:
            user._id,

          actorName:
            user.fullName,

          action:
            'SUBMIT_LEAVE',

          targetType:
            'LeaveRequest',

          targetId:
            request._id,

          affectedPerson:
            user.fullName,

          department:
            user.department,

          leaveType,

          details:
            `${totalWorkingDays} working day(s)`,
        });

        res
          .status(201)
          .json({
            success: true,

            data:
              decorate(
                request,
                user
              ),
          });
      } catch (
        error
      ) {
        if (
          uploadedAttachment
        ) {
          await deletePrivateAttachment(
            uploadedAttachment
          );
        }

        throw error;
      }
    }
  );

/* =========================================================
   APPROVE
========================================================= */

export const approve =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const request =
        await approveLeave(
          req.params.id,
          req.currentUser,
          req.body.comment
        );

      res.json({
        success: true,

        data:
          decorate(
            request,
            req.currentUser
          ),
      });
    }
  );

/* =========================================================
   REJECT
========================================================= */

export const reject =
  asyncHandler(
    async (
      req,
      res
    ) => {
      if (
        !req.body
          .comment
      ) {
        throw new ValidationError(
          'A comment is required when rejecting a request.'
        );
      }

      const request =
        await rejectLeave(
          req.params.id,
          req.currentUser,
          req.body.comment
        );

      res.json({
        success: true,

        data:
          decorate(
            request,
            req.currentUser
          ),
      });
    }
  );

/* =========================================================
   ACT ON BEHALF
========================================================= */

export const actOnBehalfOf =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const {
        approverId,
        action,
        comment,
      } =
        req.body;

      if (
        !approverId
      ) {
        throw new ValidationError(
          'approverId is required.'
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
          'action must be "approved" or "rejected".'
        );
      }

      const request =
        await actOnBehalf(
          req.params.id,
          req.currentUser,
          approverId,
          action,
          comment
        );

      res.json({
        success: true,

        data:
          decorate(
            request,
            req.currentUser
          ),
      });
    }
  );

/* =========================================================
   LOAD ACTIVE OWN APPROVED LEAVE
========================================================= */

async function loadActiveOwnLeave(
  requestId,
  user
) {
  const original =
    await LeaveRequest.findById(
      requestId
    );

  if (
    !original
  ) {
    throw new NotFoundError();
  }

  if (
    String(
      original.employeeId
    ) !==
    String(
      user._id
    )
  ) {
    throw new NotFoundError();
  }

  if (
    original.status !==
    'approved'
  ) {
    throw new ForbiddenError(
      'Only an approved leave request can be modified.'
    );
  }

  const effectiveEnd =
    original.actualEndDate ||
    original.endDate;

  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  if (
    new Date(
      effectiveEnd
    ) <
    today
  ) {
    throw new ForbiddenError(
      'This leave has already ended.'
    );
  }

  return original;
}

/* =========================================================
   EXTEND LEAVE
========================================================= */

export const extendLeave =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const user =
        req.currentUser;

      const original =
        await loadActiveOwnLeave(
          req.params.id,
          user
        );

      const {
        newEndDate,
        reason,
      } =
        req.body;

      if (
        !newEndDate ||
        !reason
      ) {
        throw new ValidationError(
          'A new end date and a reason are required.'
        );
      }

      const end =
        new Date(
          newEndDate
        );

      const currentEnd =
        new Date(
          original.actualEndDate ||
          original.endDate
        );

      if (
        Number.isNaN(
          end.getTime()
        )
      ) {
        throw new ValidationError(
          'Invalid date supplied.'
        );
      }

      if (
        end <=
        currentEnd
      ) {
        throw new ValidationError(
          'The new end date must be after the current end date.'
        );
      }

      const start =
        new Date(
          currentEnd
        );

      start.setDate(
        start.getDate() +
          1
      );

      const saturdayOff =
        await saturdayOffFor(
          user.department
        );

      const totalWorkingDays =
        calcWorkingDays(
          start,
          end,
          saturdayOff
        );

      if (
        totalWorkingDays ===
        0
      ) {
        throw new ValidationError(
          'The extension contains no working days.'
        );
      }

      const policy =
        await resolvePolicy(
          original.leaveType,
          user
        );

      const chain =
        await resolveChainFor(
          policy,
          user
        );

      const extension =
        await LeaveRequest.create(
          {
            employeeId:
              user._id,

            employeeName:
              user.fullName,

            department:
              user.department,

            leaveType:
              original.leaveType,

            startDate:
              start,

            endDate:
              end,

            totalDaysRequested:
              calcCalendarDays(
                start,
                end
              ),

            totalWorkingDays,

            excludedWeekendDates:
              getExcludedWeekendDates(
                start,
                end,
                saturdayOff
              ),

            reason,

            isExtension:
              true,

            originalRequestId:
              original._id,

            isPaidOverride:
              req.body
                .isPaidOverride ??
              null,

            ...chain,

            approvedByIds:
              [],

            rejectedByIds:
              [],

            status:
              'pending',
          }
        );

      await notifyGatekeeper(
        extension,
        'extension_requested'
      );

      await audit({
        actorId:
          user._id,

        actorName:
          user.fullName,

        action:
          'EXTEND_LEAVE',

        targetType:
          'LeaveRequest',

        targetId:
          extension._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        leaveType:
          original.leaveType,

        details:
          `Extension of ${original._id} to ${end
            .toISOString()
            .split('T')[0]}`,
      });

      res
        .status(201)
        .json({
          success: true,

          data:
            decorate(
              extension,
              user
            ),
        });
    }
  );

/* =========================================================
   REQUEST STOP LEAVE
========================================================= */

export const requestStopLeave =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const user =
        req.currentUser;

      const original =
        await loadActiveOwnLeave(
          req.params.id,
          user
        );

      const {
        returnDate,
        reason,
      } =
        req.body;

      if (
        !returnDate ||
        !reason
      ) {
        throw new ValidationError(
          'A return date and a reason are required.'
        );
      }

      const stopDate =
        new Date(
          returnDate
        );

      if (
        Number.isNaN(
          stopDate.getTime()
        )
      ) {
        throw new ValidationError(
          'Invalid date supplied.'
        );
      }

      if (
        stopDate <
        new Date(
          original.startDate
        )
      ) {
        throw new ValidationError(
          'The return date cannot be before the leave started.'
        );
      }

      if (
        stopDate >=
        new Date(
          original.actualEndDate ||
          original.endDate
        )
      ) {
        throw new ValidationError(
          'The return date must be before the current end date.'
        );
      }

      const policy =
        await resolvePolicy(
          original.leaveType,
          user
        );

      const chain =
        await resolveChainFor(
          policy,
          user
        );

      const stopRequest =
        await LeaveRequest.create(
          {
            employeeId:
              user._id,

            employeeName:
              user.fullName,

            department:
              user.department,

            leaveType:
              original.leaveType,

            startDate:
              original.startDate,

            endDate:
              stopDate,

            totalDaysRequested:
              0,

            totalWorkingDays:
              0,

            reason,

            isStopRequest:
              true,

            originalRequestId:
              original._id,

            ...chain,

            approvedByIds:
              [],

            rejectedByIds:
              [],

            status:
              'pending',
          }
        );

      await notifyGatekeeper(
        stopRequest,
        'stop_requested'
      );

      await audit({
        actorId:
          user._id,

        actorName:
          user.fullName,

        action:
          'REQUEST_STOP_LEAVE',

        targetType:
          'LeaveRequest',

        targetId:
          stopRequest._id,

        affectedPerson:
          user.fullName,

        department:
          user.department,

        leaveType:
          original.leaveType,

        details:
          `Requested to return on ${stopDate
            .toISOString()
            .split('T')[0]}`,
      });

      res
        .status(201)
        .json({
          success: true,

          data:
            decorate(
              stopRequest,
              user
            ),
        });
    }
  );

/* =========================================================
   BALANCE
========================================================= */

export const getBalance =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const {
        employeeId,
      } =
        req.params;

      const isSelf =
        String(
          employeeId
        ) ===
        String(
          req.currentUser
            ._id
        );

      if (
        !isSelf &&
        req.currentUser
          .role ===
          'employee'
      ) {
        throw new NotFoundError();
      }

      const employee =
        await User.findById(
          employeeId
        );

      if (
        !employee
      ) {
        throw new NotFoundError();
      }

      const balances =
        await getLeaveBalancesForUser(
          employeeId
        );

      res.json({
        success: true,

        data:
          balances,
      });
    }
  );