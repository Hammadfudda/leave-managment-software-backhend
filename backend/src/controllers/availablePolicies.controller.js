import LeavePolicy from '../models/LeavePolicy.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  checkApplicantScope,
} from '../services/eligibility.service.js';

import {
  policySpecificity,
} from '../services/balance.service.js';

function safePolicy(
  policy
) {
  return {
    _id:
      policy._id,

    leaveType:
      policy.leaveType,

    yearlyQuota:
      Number(
        policy.yearlyQuota ??
          0
      ),

    applicableRole:
      policy.applicableRole,

    isPaid:
      policy.isPaid,

    documentRequirement:
      policy.documentRequirement,

    approvalRouting: {
      grade:
        policy
          .approvalRouting
          ?.grade ??
        null,

      department:
        policy
          .approvalRouting
          ?.department ??
        null,

      designation:
        policy
          .approvalRouting
          ?.designation ??
        null,
    },

    finalApprovalMode:
      Boolean(
        policy.finalApprovalMode
      ),

    adminOnlyApproval:
      Boolean(
        policy.adminOnlyApproval
      ),
  };
}

export const listAvailablePolicies =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const policies =
        await LeavePolicy.find(
          {}
        );

      const matching =
        policies.filter(
          (policy) =>
            checkApplicantScope(
              policy,
              req.currentUser
            ) === null &&
            Number(
              policy.yearlyQuota ??
                0
            ) > 0
        );

      const bestByType =
        new Map();

      for (
        const policy of matching
      ) {
        const type =
          String(
            policy.leaveType
          )
            .trim()
            .toLowerCase();

        const existing =
          bestByType.get(
            type
          );

        if (
          !existing ||
          policySpecificity(
            policy
          ) >
            policySpecificity(
              existing
            )
        ) {
          bestByType.set(
            type,
            policy
          );
        }
      }

      res.json({
        success: true,
        data: [
          ...bestByType.values(),
        ].map(
          safePolicy
        ),
      });
    }
  );
