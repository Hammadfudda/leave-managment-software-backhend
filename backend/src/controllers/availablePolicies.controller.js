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
| GET /api/leaves/available-policies
| Entitlement is Grade-based only.
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
          .populate(
            'gradeQuotas.gradeId',
            'name'
          )
          .sort({
            leaveType: 1,
          });

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
