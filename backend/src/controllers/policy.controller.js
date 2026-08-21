import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';
import Grade from '../models/Grade.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  audit,
} from '../utils/audit.js';

import {
  syncCurrentYearBalancesForAllEmployees,
} from '../services/balance.service.js';

import {
  getPagination,
  paginated,
} from '../utils/pagination.js';

function normalizeLeaveType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeDocumentRequirement(
  value
) {
  const allowed = [
    'required',
    'optional',
    'not_required',
  ];

  return allowed.includes(value)
    ? value
    : 'optional';
}

async function normalizeGradeQuotas(
  raw
) {
  if (
    !Array.isArray(raw) ||
    raw.length === 0
  ) {
    throw new ValidationError(
      'Select at least one grade and yearly quota.'
    );
  }

  const seen = new Set();

  const normalized =
    raw.map((item) => {
      const gradeId =
        String(
          item?.gradeId ||
          ''
        ).trim();

      const yearlyQuota =
        Number(
          item?.yearlyQuota
        );

      if (!gradeId) {
        throw new ValidationError(
          'Every selected grade requires a valid grade ID.'
        );
      }

      if (
        !Number.isFinite(
          yearlyQuota
        ) ||
        yearlyQuota <= 0
      ) {
        throw new ValidationError(
          'Every selected grade needs a yearly quota greater than 0.'
        );
      }

      if (
        seen.has(
          gradeId
        )
      ) {
        throw new ValidationError(
          'A grade can only appear once in a leave policy.'
        );
      }

      seen.add(
        gradeId
      );

      return {
        gradeId,
        yearlyQuota,
      };
    });

  const count =
    await Grade.countDocuments({
      _id: {
        $in:
          normalized.map(
            (item) =>
              item.gradeId
          ),
      },
    });

  if (
    count !==
    normalized.length
  ) {
    throw new ValidationError(
      'One or more selected grades do not exist.'
    );
  }

  return normalized;
}

async function normalizeApproval(
  body
) {
  const finalApprovalMode =
    body.finalApprovalMode !==
    false;

  if (
    finalApprovalMode
  ) {
    return {
      finalApprovalMode:
        true,
      approverIds: [],
    };
  }

  const rawIds =
    body
      .approvalRouting
      ?.approverIds;

  const approverIds =
    Array.isArray(
      rawIds
    )
      ? [
          ...new Set(
            rawIds
              .map(String)
              .filter(Boolean)
          ),
        ]
      : [];

  if (
    approverIds.length === 0
  ) {
    throw new ValidationError(
      'Select at least one manager for the manual approval chain.'
    );
  }

  const managerCount =
    await User.countDocuments({
      _id: {
        $in:
          approverIds,
      },
      role: 'manager',
      status: 'active',
    });

  if (
    managerCount !==
    approverIds.length
  ) {
    throw new ValidationError(
      'One or more selected approvers are not active managers.'
    );
  }

  return {
    finalApprovalMode:
      false,
    approverIds,
  };
}

export const listPolicies =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const filter = {};

      if (
        req.query.leaveType
      ) {
        filter.leaveType =
          normalizeLeaveType(
            req.query.leaveType
          );
      }

      /*
       * Managers can read policies too.
       * Policy entitlement is grade-based, not manager-specific.
       */
      const pagination =
        getPagination(
          req.query
        );

      const [
        items,
        total,
      ] =
        await Promise.all([
          LeavePolicy.find(
            filter
          )
            .populate(
              'gradeQuotas.gradeId',
              'name'
            )
            .populate(
              'approvalRouting.approverIds',
              'fullName email role department designation'
            )
            .sort({
              createdAt: -1,
            })
            .skip(
              pagination.skip
            )
            .limit(
              pagination.limit
            ),

          LeavePolicy.countDocuments(
            filter
          ),
        ]);

      res.json({
        success: true,
        ...paginated(
          items,
          total,
          pagination
        ),
      });
    }
  );

export const createPolicy =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const leaveType =
        normalizeLeaveType(
          req.body.leaveType
        );

      if (!leaveType) {
        throw new ValidationError(
          'Leave type is required.'
        );
      }

      const existing =
        await LeavePolicy.findOne({
          leaveType,
        })
          .select('_id')
          .lean();

      if (existing) {
        throw new ConflictError(
          'A leave policy already exists for this leave type. Edit the existing policy instead.'
        );
      }

      const gradeQuotas =
        await normalizeGradeQuotas(
          req.body
            .gradeQuotas
        );

      const {
        finalApprovalMode,
        approverIds,
      } =
        await normalizeApproval(
          req.body
        );

      const carryForwardAllowed =
        Boolean(
          req.body
            .carryForwardAllowed
        );

      const maxCarryForwardDays =
        carryForwardAllowed
          ? Number(
              req.body
                .maxCarryForwardDays ||
              0
            )
          : 0;

      if (
        !Number.isFinite(
          maxCarryForwardDays
        ) ||
        maxCarryForwardDays < 0
      ) {
        throw new ValidationError(
          'Max carry forward days must be 0 or greater.'
        );
      }

      const policy =
        await LeavePolicy.create(
          {
            leaveType,
            gradeQuotas,

            isPaid:
              req.body.isPaid !==
              undefined
                ? Boolean(
                    req.body.isPaid
                  )
                : true,

            documentRequirement:
              normalizeDocumentRequirement(
                req.body
                  .documentRequirement
              ),

            carryForwardAllowed,
            maxCarryForwardDays,

            finalApprovalMode,

            approvalRouting: {
              approverIds,
            },

            minDaysNoticeRequired:
              0,

            adminOnlyApproval:
              false,
          }
        );

      await syncCurrentYearBalancesForAllEmployees();

      await audit({
        actorId:
          req.currentUser._id,
        actorName:
          req.currentUser.fullName,
        action:
          'CREATE_LEAVE_POLICY',
        targetType:
          'LeavePolicy',
        targetId:
          policy._id,
        leaveType:
          policy.leaveType,
        details:
          `Created ${policy.leaveType} policy with ${gradeQuotas.length} grade quota(s).`,
      });

      const populated =
        await LeavePolicy.findById(
          policy._id
        )
          .populate(
            'gradeQuotas.gradeId',
            'name'
          )
          .populate(
            'approvalRouting.approverIds',
            'fullName email role department designation'
          );

      res
        .status(201)
        .json({
          success: true,
          data:
            populated,
        });
    }
  );

export const updatePolicy =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const policy =
        await LeavePolicy.findById(
          req.params.id
        );

      if (!policy) {
        throw new NotFoundError(
          'Leave policy not found.'
        );
      }

      const leaveType =
        req.body.leaveType !==
        undefined
          ? normalizeLeaveType(
              req.body.leaveType
            )
          : policy.leaveType;

      if (!leaveType) {
        throw new ValidationError(
          'Leave type is required.'
        );
      }

      const clash =
        await LeavePolicy.findOne({
          leaveType,
          _id: {
            $ne:
              policy._id,
          },
        })
          .select('_id')
          .lean();

      if (clash) {
        throw new ConflictError(
          'Another leave policy already uses this leave type.'
        );
      }

      const gradeQuotas =
        req.body
          .gradeQuotas !==
        undefined
          ? await normalizeGradeQuotas(
              req.body
                .gradeQuotas
            )
          : policy
              .gradeQuotas;

      const {
        finalApprovalMode,
        approverIds,
      } =
        await normalizeApproval({
          ...req.body,
          finalApprovalMode:
            req.body
              .finalApprovalMode !==
            undefined
              ? req.body
                  .finalApprovalMode
              : policy
                  .finalApprovalMode,

          approvalRouting:
            req.body
              .approvalRouting !==
            undefined
              ? req.body
                  .approvalRouting
              : policy
                  .approvalRouting,
        });

      const carryForwardAllowed =
        req.body
          .carryForwardAllowed !==
        undefined
          ? Boolean(
              req.body
                .carryForwardAllowed
            )
          : Boolean(
              policy
                .carryForwardAllowed
            );

      const maxCarryForwardDays =
        carryForwardAllowed
          ? Number(
              req.body
                .maxCarryForwardDays !==
              undefined
                ? req.body
                    .maxCarryForwardDays
                : policy
                    .maxCarryForwardDays ||
                  0
            )
          : 0;

      if (
        !Number.isFinite(
          maxCarryForwardDays
        ) ||
        maxCarryForwardDays < 0
      ) {
        throw new ValidationError(
          'Max carry forward days must be 0 or greater.'
        );
      }

      policy.leaveType =
        leaveType;

      policy.gradeQuotas =
        gradeQuotas;

      if (
        req.body.isPaid !==
        undefined
      ) {
        policy.isPaid =
          Boolean(
            req.body.isPaid
          );
      }

      if (
        req.body
          .documentRequirement !==
        undefined
      ) {
        policy.documentRequirement =
          normalizeDocumentRequirement(
            req.body
              .documentRequirement
          );
      }

      policy.carryForwardAllowed =
        carryForwardAllowed;

      policy.maxCarryForwardDays =
        maxCarryForwardDays;

      policy.finalApprovalMode =
        finalApprovalMode;

      policy.approvalRouting = {
        approverIds,
      };

      policy.minDaysNoticeRequired =
        0;

      policy.adminOnlyApproval =
        false;

      await policy.save();

      await syncCurrentYearBalancesForAllEmployees();

      await audit({
        actorId:
          req.currentUser._id,
        actorName:
          req.currentUser.fullName,
        action:
          'EDIT_LEAVE_POLICY',
        targetType:
          'LeavePolicy',
        targetId:
          policy._id,
        leaveType:
          policy.leaveType,
        details:
          `Updated ${policy.leaveType} policy with ${policy.gradeQuotas.length} grade quota(s).`,
      });

      const populated =
        await LeavePolicy.findById(
          policy._id
        )
          .populate(
            'gradeQuotas.gradeId',
            'name'
          )
          .populate(
            'approvalRouting.approverIds',
            'fullName email role department designation'
          );

      res.json({
        success: true,
        data:
          populated,
      });
    }
  );

export const deletePolicy =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const policy =
        await LeavePolicy.findById(
          req.params.id
        );

      if (!policy) {
        throw new NotFoundError(
          'Leave policy not found.'
        );
      }

      const leaveType =
        policy.leaveType;

      const policyId =
        policy._id;

      await policy.deleteOne();

      await syncCurrentYearBalancesForAllEmployees();

      await audit({
        actorId:
          req.currentUser._id,
        actorName:
          req.currentUser.fullName,
        action:
          'DELETE_LEAVE_POLICY',
        targetType:
          'LeavePolicy',
        targetId:
          policyId,
        leaveType,
        details:
          `Deleted ${leaveType} policy`,
      });

      res.json({
        success: true,
        message:
          'Leave policy deleted successfully.',
      });
    }
  );

export const listEligibleApprovers =
  asyncHandler(
    async (
      _req,
      res
    ) => {
      const approvers =
        await User.find({
          role: 'manager',
          status: 'active',
        })
          .select(
            '_id fullName email role department designation'
          )
          .sort({
            fullName: 1,
          });

      res.json({
        success: true,
        data:
          approvers.map(
            (manager) => ({
              id:
                manager._id,
              fullName:
                manager.fullName,
              email:
                manager.email,
              role:
                manager.role,
              department:
                manager.department,
              designation:
                manager.designation,
            })
          ),
      });
    }
  );
