import LeaveRequest from '../models/LeaveRequest.js';
import Department from '../models/Department.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ValidationError,
} from '../utils/errors.js';

import {
  calcWorkingDays,
} from '../utils/dates.js';

import {
  getLeaveBalancesForUser,
} from '../services/balance.service.js';

function normalizeDate(
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

function prettyLeaveType(
  leaveType
) {
  return String(
    leaveType ||
    'leave'
  )
    .trim()
    .replaceAll(
      '_',
      ' '
    );
}

export const validateNewLeaveRequest =
  asyncHandler(
    async (
      req,
      _res,
      next
    ) => {
      const user =
        req.currentUser;

      /*
       * Runs after multer.memoryStorage().
       * No Cloudinary upload or LeaveRequest.create has happened yet.
       */

      const pendingRequest =
        await LeaveRequest.findOne({
          employeeId:
            user._id,

          status:
            'pending',

          isExtension: {
            $ne: true,
          },

          isStopRequest: {
            $ne: true,
          },
        })
          .select(
            'leaveType'
          )
          .lean();

      if (
        pendingRequest
      ) {
        throw new ValidationError(
          `You already have a pending ${prettyLeaveType(
            pendingRequest.leaveType
          )} leave request. Wait until it is approved or rejected before applying for another leave.`
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

      /*
       * Latest rule:
       * An APPROVED leave blocks a new leave only once the leave has started.
       *
       * startDate <= today <= actualEndDate/endDate
       *
       * A future approved leave does not lock the Apply Leave screen before
       * its start date.
       */
      const approvedRequests =
        await LeaveRequest.find({
          employeeId:
            user._id,

          status:
            'approved',

          isExtension: {
            $ne: true,
          },

          isStopRequest: {
            $ne: true,
          },
        })
          .select(
            'leaveType startDate endDate actualEndDate'
          )
          .lean();

      const activeApprovedLeave =
        approvedRequests.find(
          (request) => {
            const start =
              normalizeDate(
                request.startDate
              );

            const effectiveEnd =
              normalizeDate(
                request.actualEndDate ||
                  request.endDate
              );

            return (
              start &&
              effectiveEnd &&
              start <=
                today &&
              effectiveEnd >=
                today
            );
          }
        );

      if (
        activeApprovedLeave
      ) {
        const effectiveEnd =
          normalizeDate(
            activeApprovedLeave.actualEndDate ||
              activeApprovedLeave.endDate
          );

        const formattedEnd =
          effectiveEnd
            .toISOString()
            .split('T')[0];

        throw new ValidationError(
          `Your approved ${prettyLeaveType(
            activeApprovedLeave.leaveType
          )} leave is currently active until ${formattedEnd}. You cannot apply for another leave while it is active.`
        );
      }

      const {
        leaveType,
        startDate,
        endDate,
      } = req.body;

      if (
        !leaveType ||
        !startDate ||
        !endDate
      ) {
        return next();
      }

      const start =
        normalizeDate(
          startDate
        );

      const end =
        normalizeDate(
          endDate
        );

      if (
        !start ||
        !end
      ) {
        return next();
      }

      if (
        end < start
      ) {
        throw new ValidationError(
          'End date cannot be before the start date.'
        );
      }

      const department =
        await Department.findOne({
          name:
            user.department,
        })
          .select(
            'saturdayOff'
          )
          .lean();

      const saturdayOff =
        department
          ?.saturdayOff ??
        true;

      const requestedWorkingDays =
        calcWorkingDays(
          start,
          end,
          saturdayOff
        );

      if (
        requestedWorkingDays <=
        0
      ) {
        throw new ValidationError(
          'The selected range contains no working days.'
        );
      }

      const balances =
        await getLeaveBalancesForUser(
          user._id
        );

      const normalizedLeaveType =
        String(
          leaveType
        )
          .trim()
          .toLowerCase();

      const balance =
        balances[
          normalizedLeaveType
        ];

      if (
        balance &&
        requestedWorkingDays >
          Number(
            balance.remaining ||
              0
          )
      ) {
        throw new ValidationError(
          `You only have ${balance.remaining} day(s) remaining for ${prettyLeaveType(
            normalizedLeaveType
          )}. You cannot request ${requestedWorkingDays} working day(s).`
        );
      }

      next();
    }
  );
