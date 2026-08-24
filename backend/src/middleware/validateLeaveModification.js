import LeaveRequest from '../models/LeaveRequest.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

function normalizeDay(
  value
) {
  const date =
    new Date(
      value
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  date.setHours(
    0,
    0,
    0,
    0
  );

  return date;
}

/*
|--------------------------------------------------------------------------
| VALIDATE LEAVE MODIFICATION
|--------------------------------------------------------------------------
|
| Applies before /:id/extend and /:id/request-stop.
|
| Rules:
| - user can modify only their own original approved leave
| - leave must be active TODAY (not future / already ended)
| - Extension is blocked while a Stop request is pending or approved
|
| Existing controller validation remains in place as a second layer.
|
*/
export const validateLeaveModification =
  asyncHandler(
    async (
      req,
      _res,
      next
    ) => {
      const user =
        req.currentUser;

      const original =
        await LeaveRequest.findById(
          req.params.id
        )
          .select(
            'employeeId status startDate endDate actualEndDate isExtension isStopRequest'
          )
          .lean();

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
        original.isExtension ||
        original.isStopRequest
      ) {
        throw new ValidationError(
          'Only the original leave request can be modified.'
        );
      }

      if (
        original.status !==
        'approved'
      ) {
        throw new ForbiddenError(
          'Only an approved leave request can be modified.'
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

      const start =
        normalizeDay(
          original.startDate
        );

      const effectiveEnd =
        normalizeDay(
          original.actualEndDate ||
            original.endDate
        );

      if (
        !start ||
        !effectiveEnd
      ) {
        throw new ValidationError(
          'Leave dates are invalid.'
        );
      }

      if (
        today < start
      ) {
        throw new ForbiddenError(
          'This leave has not started yet.'
        );
      }

      if (
        today >
        effectiveEnd
      ) {
        throw new ForbiddenError(
          'This leave has already ended.'
        );
      }

      /*
       * A Stop request and an Extension should never race against each other.
       * Once Stop is pending/approved, extension is unavailable.
       */
      if (
        req.path.endsWith(
          '/extend'
        )
      ) {
        const blockingStop =
          await LeaveRequest.exists({
            originalRequestId:
              original._id,

            isStopRequest:
              true,

            status: {
              $in: [
                'pending',
                'approved',
              ],
            },
          });

        if (
          blockingStop
        ) {
          throw new ValidationError(
            'This leave has a pending or approved stop request and can no longer be extended.'
          );
        }
      }

      next();
    }
  );
