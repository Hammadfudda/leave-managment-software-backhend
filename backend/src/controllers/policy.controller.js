import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';
import Grade from '../models/Grade.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  audit,
} from '../utils/audit.js';

import {
  getEligibleApprovers,
} from '../services/eligibility.service.js';

import {
  syncCurrentYearBalancesForAllEmployees,
} from '../services/balance.service.js';

import {
  getPagination,
  paginated,
} from '../utils/pagination.js';

function optionalString(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(value).trim();

  if (
    !text ||
    text ===
      'All Grades' ||
    text ===
      'All Departments' ||
    text ===
      'All Designations'
  ) {
    return null;
  }

  return text;
}

function normalizeRouting(
  body,
  disableApprovers
) {
  const routing =
    body.approvalRouting ||
    {};

  const approverIds =
    disableApprovers ||
    !Array.isArray(
      routing.approverIds
    )
      ? []
      : [
          ...new Set(
            routing
              .approverIds
              .map(String)
              .filter(Boolean)
          ),
        ];

  return {
    grade:
      optionalString(
        routing.grade
      ),

    department:
      optionalString(
        routing.department
      ),

    designation:
      optionalString(
        routing.designation
      ),

    approverIds,
  };
}

function normalizeQuota(
  value
) {
  const quota =
    Number(value);

  if (
    !Number.isFinite(
      quota
    ) ||
    quota <= 0
  ) {
    throw new ValidationError(
      'Yearly quota must be greater than 0.'
    );
  }

  return quota;
}

async function validateGrade(
  gradeId
) {
  if (!gradeId) {
    return;
  }

  const grade =
    await Grade.findById(
      gradeId
    );

  if (!grade) {
    throw new ValidationError(
      'Selected grade does not exist.'
    );
  }
}

async function validateApprovers(
  approverIds
) {
  if (
    approverIds.length ===
    0
  ) {
    return;
  }

  const count =
    await User.countDocuments(
      {
        _id: {
          $in:
            approverIds,
        },
        role: {
          $in: [
            'admin',
            'manager',
          ],
        },
        status:
          'active',
      }
    );

  if (
    count !==
    approverIds.length
  ) {
    throw new ValidationError(
      'One or more selected approvers are not valid active approvers.'
    );
  }
}

async function noDuplicate({
  leaveType,
  applicableRole,
  approvalRouting,
  excludeId = null,
}) {
  const filter = {
    leaveType,

    applicableRole,

    'approvalRouting.grade':
      approvalRouting.grade ||
      null,

    'approvalRouting.department':
      approvalRouting.department ||
      null,

    'approvalRouting.designation':
      approvalRouting.designation ||
      null,
  };

  if (excludeId) {
    filter._id = {
      $ne:
        excludeId,
    };
  }

  const duplicate =
    await LeavePolicy.findOne(
      filter
    );

  if (duplicate) {
    throw new ValidationError(
      'A leave policy already exists for this leave type, role, grade, department and designation combination.'
    );
  }
}

export const listPolicies =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const filter = {};

      if (
        req.currentUser
          .role !==
        'admin'
      ) {
        filter[
          'approvalRouting.approverIds'
        ] =
          req.currentUser
            ._id;
      }

      if (
        req.query.department
      ) {
        filter[
          'approvalRouting.department'
        ] =
          req.query.department;
      }

      if (
        req.query.leaveType
      ) {
        filter.leaveType =
          String(
            req.query.leaveType
          ).toLowerCase();
      }

      if (
        req.query.grade
      ) {
        filter[
          'approvalRouting.grade'
        ] =
          req.query.grade;
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
          LeavePolicy.find(
            filter
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

          LeavePolicy
            .countDocuments(
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
        String(
          req.body
            .leaveType ||
            ''
        )
          .trim()
          .toLowerCase();

      if (!leaveType) {
        throw new ValidationError(
          'Leave type is required.'
        );
      }

      const yearlyQuota =
        normalizeQuota(
          req.body
            .yearlyQuota
        );

      const applicableRole =
        req.body
          .applicableRole ||
        'All Employees';

      const adminOnlyApproval =
        Boolean(
          req.body
            .adminOnlyApproval
        );

      const finalApprovalMode =
        Boolean(
          req.body
            .finalApprovalMode
        );

      if (
        adminOnlyApproval &&
        finalApprovalMode
      ) {
        throw new ValidationError(
          'Admin-only approval and Final Manager approval cannot both be enabled.'
        );
      }

      const approvalRouting =
        normalizeRouting(
          req.body,
          adminOnlyApproval ||
            finalApprovalMode
        );

      await validateGrade(
        approvalRouting.grade
      );

      if (
        !adminOnlyApproval &&
        !finalApprovalMode &&
        approvalRouting
          .approverIds
          .length === 0
      ) {
        throw new ValidationError(
          'At least one approver is required.'
        );
      }

      await validateApprovers(
        approvalRouting
          .approverIds
      );

      await noDuplicate({
        leaveType,
        applicableRole,
        approvalRouting,
      });

      const policy =
        await LeavePolicy.create(
          {
            leaveType,

            yearlyQuota,

            applicableRole,

            isPaid:
              req.body.isPaid !==
              undefined
                ? Boolean(
                    req.body
                      .isPaid
                  )
                : true,

            minDaysNoticeRequired:
              0,

            documentRequirement:
              req.body
                .documentRequirement ||
              'optional',

            adminOnlyApproval,

            finalApprovalMode,

            approvalRouting,
          }
        );

      await syncCurrentYearBalancesForAllEmployees();

      await audit({
        actorId:
          req.currentUser._id,

        actorName:
          req.currentUser
            .fullName,

        action:
          'CREATE_LEAVE_POLICY',

        targetType:
          'LeavePolicy',

        targetId:
          policy._id,

        leaveType:
          policy.leaveType,

        department:
          approvalRouting
            .department,

        details:
          `Created ${policy.leaveType} policy with yearly quota ${policy.yearlyQuota}`,
      });

      res
        .status(201)
        .json({
          success: true,
          data: policy,
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
        await LeavePolicy
          .findById(
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
          ? String(
              req.body
                .leaveType
            )
              .trim()
              .toLowerCase()
          : policy.leaveType;

      const yearlyQuota =
        req.body
          .yearlyQuota !==
        undefined
          ? normalizeQuota(
              req.body
                .yearlyQuota
            )
          : normalizeQuota(
              policy.yearlyQuota
            );

      const applicableRole =
        req.body
          .applicableRole !==
        undefined
          ? req.body
              .applicableRole
          : policy
              .applicableRole;

      const adminOnlyApproval =
        req.body
          .adminOnlyApproval !==
        undefined
          ? Boolean(
              req.body
                .adminOnlyApproval
            )
          : Boolean(
              policy
                .adminOnlyApproval
            );

      const finalApprovalMode =
        req.body
          .finalApprovalMode !==
        undefined
          ? Boolean(
              req.body
                .finalApprovalMode
            )
          : Boolean(
              policy
                .finalApprovalMode
            );

      if (
        adminOnlyApproval &&
        finalApprovalMode
      ) {
        throw new ValidationError(
          'Admin-only approval and Final Manager approval cannot both be enabled.'
        );
      }

      let approvalRouting = {
        grade:
          policy
            .approvalRouting
            ?.grade ||
          null,

        department:
          policy
            .approvalRouting
            ?.department ||
          null,

        designation:
          policy
            .approvalRouting
            ?.designation ||
          null,

        approverIds:
          (
            policy
              .approvalRouting
              ?.approverIds ||
            []
          ).map(String),
      };

      if (
        req.body
          .approvalRouting !==
        undefined
      ) {
        approvalRouting =
          normalizeRouting(
            req.body,
            adminOnlyApproval ||
              finalApprovalMode
          );
      }

      if (
        adminOnlyApproval ||
        finalApprovalMode
      ) {
        approvalRouting
          .approverIds =
          [];
      }

      await validateGrade(
        approvalRouting.grade
      );

      if (
        !adminOnlyApproval &&
        !finalApprovalMode &&
        approvalRouting
          .approverIds
          .length === 0
      ) {
        throw new ValidationError(
          'At least one approver is required.'
        );
      }

      await validateApprovers(
        approvalRouting
          .approverIds
      );

      await noDuplicate({
        leaveType,
        applicableRole,
        approvalRouting,
        excludeId:
          policy._id,
      });

      policy.leaveType =
        leaveType;

      policy.yearlyQuota =
        yearlyQuota;

      policy.applicableRole =
        applicableRole;

      if (
        req.body.isPaid !==
        undefined
      ) {
        policy.isPaid =
          Boolean(
            req.body
              .isPaid
          );
      }

      policy.minDaysNoticeRequired =
        0;

      if (
        req.body
          .documentRequirement !==
        undefined
      ) {
        policy.documentRequirement =
          req.body
            .documentRequirement;
      }

      policy.adminOnlyApproval =
        adminOnlyApproval;

      policy.finalApprovalMode =
        finalApprovalMode;

      policy.approvalRouting =
        approvalRouting;

      await policy.save();

      await syncCurrentYearBalancesForAllEmployees();

      await audit({
        actorId:
          req.currentUser._id,

        actorName:
          req.currentUser
            .fullName,

        action:
          'EDIT_LEAVE_POLICY',

        targetType:
          'LeavePolicy',

        targetId:
          policy._id,

        leaveType:
          policy.leaveType,

        department:
          approvalRouting
            .department,

        details:
          `Updated ${policy.leaveType} policy. Yearly quota: ${policy.yearlyQuota}`,
      });

      res.json({
        success: true,
        data: policy,
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
        await LeavePolicy
          .findById(
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
          req.currentUser
            .fullName,

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
      req,
      res
    ) => {
      const department =
        req.query
          .department ||
        null;

      const approvers =
        await getEligibleApprovers(
          department
        );

      res.json({
        success: true,
        data:
          approvers.map(
            (user) => ({
              id:
                user._id,

              fullName:
                user.fullName,

              email:
                user.email,

              role:
                user.role,

              department:
                user.department,

              designation:
                user.designation,
            })
          ),
      });
    }
  );
