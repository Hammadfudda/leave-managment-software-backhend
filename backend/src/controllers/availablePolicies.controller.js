import LeavePolicy from '../models/LeavePolicy.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  checkApplicantScope,
} from '../services/eligibility.service.js';

/*
|--------------------------------------------------------------------------
| AVAILABLE LEAVE POLICIES FOR CURRENT USER
|--------------------------------------------------------------------------
|
| Used by:
|   GET /api/leaves/available-policies
|
| Important:
| - Does not create or modify policies.
| - Does not change approval routing.
| - Only returns policies that apply to the logged-in employee/manager.
| - Pending CSV employees receive no available policies until their required
|   employee details are completed.
|
*/
export const listAvailablePolicies =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const user =
        req.currentUser;

      /*
       * CSV pending employees must complete required profile details before
       * leave entitlement/policies become available.
       */
      if (
        user?.detailsStatus ===
        'pending'
      ) {
        return res.json({
          success: true,
          data: [],
        });
      }

      const policies =
        await LeavePolicy.find({})
          .sort({
            leaveType: 1,
            createdAt: 1,
          })
          .lean();

      const available =
        policies.filter(
          (policy) =>
            checkApplicantScope(
              policy,
              user
            ) === null
        );

      return res.json({
        success: true,
        data:
          available,
      });
    }
  );
