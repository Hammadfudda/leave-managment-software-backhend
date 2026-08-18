import LeavePolicy from '../models/LeavePolicy.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  checkApplicantScope,
} from '../services/eligibility.service.js';

function isSpecific(
  value,
  wildcardLabel
) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    value !== wildcardLabel
  );
}

function policyScore(policy) {
  const routing =
    policy.approvalRouting || {};

  return (
    (
      isSpecific(
        routing.grade,
        'All Grades'
      )
        ? 4
        : 0
    ) +
    (
      isSpecific(
        routing.department,
        'All Departments'
      )
        ? 2
        : 0
    ) +
    (
      isSpecific(
        routing.designation,
        'All Designations'
      )
        ? 1
        : 0
    )
  );
}

function toSafePolicy(policy) {
  return {
    _id: policy._id,
    leaveType:
      policy.leaveType,
    applicableRole:
      policy.applicableRole,
    documentRequirement:
      policy.documentRequirement,
    approvalRouting: {
      grade:
        policy.approvalRouting
          ?.grade ??
        null,

      department:
        policy.approvalRouting
          ?.department ??
        null,

      designation:
        policy.approvalRouting
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
      const user =
        req.currentUser;

      const policies =
        await LeavePolicy.find({});

      const matching =
        policies.filter(
          (policy) =>
            checkApplicantScope(
              policy,
              user
            ) === null
        );

      const bestByLeaveType =
        new Map();

      for (
        const policy of matching
      ) {
        const type =
          policy.leaveType;

        const existing =
          bestByLeaveType.get(
            type
          );

        if (
          !existing ||
          policyScore(policy) >
            policyScore(
              existing
            )
        ) {
          bestByLeaveType.set(
            type,
            policy
          );
        }
      }

      const data = [
        ...bestByLeaveType.values(),
      ].map(
        toSafePolicy
      );

      res.json({
        success: true,
        data,
      });
    }
  );
