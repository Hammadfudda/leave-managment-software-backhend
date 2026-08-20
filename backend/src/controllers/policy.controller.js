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
      'All Departments' ||
    text ===
      'All Designations'
  ) {
    return null;
  }

  return text;
}

function normalizeGradeQuotas(
  value
) {
  if (
    !Array.isArray(value) ||
    value.length === 0
  ) {
    throw new ValidationError(
      'Select at least one grade and enter its yearly quota.'
    );
  }

  const seen =
    new Set();

  return value.map(
    (row) => {
      const gradeId =
        String(
          row.gradeId ||
          ''
        ).trim();

      const yearlyQuota =
        Number(
          row.yearlyQuota
        );

      if (!gradeId) {
        throw new ValidationError(
          'Every selected grade must have a valid Grade ID.'
        );
      }

      if (
        seen.has(
          gradeId
        )
      ) {
        throw new ValidationError(
          'The same grade cannot be added twice to one leave policy.'
        );
      }

      if (
        !Number.isFinite(
          yearlyQuota
        ) ||
        yearlyQuota <= 0
      ) {
        throw new ValidationError(
          'Every selected grade must have a yearly quota greater than 0.'
        );
      }

      seen.add(
        gradeId
      );

      return {
        gradeId,
        yearlyQuota,
      };
    }
  );
}

async function validateGrades(
  gradeQuotas
) {
  const ids =
    gradeQuotas.map(
      (row) =>
        row.gradeId
    );

  const count =
    await Grade.countDocuments(
      {
        _id: {
          $in: ids,
        },
      }
    );

  if (
    count !== ids.length
  ) {
    throw new ValidationError(
      'One or more selected grades do not exist in Master Data.'
    );
  }
}

function normalizeRouting(
  body,
  finalApprovalMode
) {
  const routing =
    body.approvalRouting ||
    {};

  return {
    department:
      optionalString(
        routing.department
      ),

    designation:
      optionalString(
        routing.designation
      ),

    approverIds:
      finalApprovalMode
        ? []
        : [
            ...new Set(
              (
                Array.isArray(
                  routing.approverIds
                )
                  ? routing.approverIds
                  : []
              )
                .map(String)
                .filter(Boolean)
            ),
          ],
  };
}

async function validateManagers(
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

        role:
          'manager',

        status:
          'active',
      }
    );

  if (
    count !==
    approverIds.length
  ) {
    throw new ValidationError(
      'Only active Managers can be selected in Leave Policy routing.'
    );
  }
}

async function noDuplicate({
  leaveType,
  applicableRole,
  gradeQuotas,
  approvalRouting,
  excludeId = null,
}) {
  const gradeIds =
    gradeQuotas.map(
      (row) =>
        row.gradeId
    );

  const filter = {
    leaveType,
    applicableRole,

    'approvalRouting.department':
      approvalRouting.department ||
      null,

    'approvalRouting.designation':
      approvalRouting.designation ||
      null,

    'gradeQuotas.gradeId': {
      $in:
        gradeIds,
    },
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
      'A conflicting leave policy already exists for at least one selected grade with this role, department and designation scope.'
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
          )
            .trim()
            .toLowerCase();
      }

      if (
        req.query.grade
      ) {
        filter[
          'gradeQuotas.gradeId'
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

      const gradeQuotas =
        normalizeGradeQuotas(
          req.body
            .gradeQuotas
        );

      await validateGrades(
        gradeQuotas
      );

      const applicableRole =
        req.body
          .applicableRole ||
        'All Employees';

      const finalApprovalMode =
        req.body
          .finalApprovalMode !==
        undefined
          ? Boolean(
              req.body
                .finalApprovalMode
            )
          : true;

      const approvalRouting =
        normalizeRouting(
          req.body,
          finalApprovalMode
        );

      if (
        !finalApprovalMode &&
        approvalRouting
          .approverIds
          .length === 0
      ) {
        throw new ValidationError(
          'Select at least one Manager or use Assigned Manager Final.'
        );
      }

      await validateManagers(
        approvalRouting
          .approverIds
      );

      await noDuplicate({
        leaveType,
        applicableRole,
        gradeQuotas,
        approvalRouting,
      });

      const policy =
        await LeavePolicy.create(
          {
            leaveType,
            gradeQuotas,
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
          `Created ${policy.leaveType} policy for ${gradeQuotas.length} grade(s)`,
      });

      const populated =
        await LeavePolicy
          .findById(
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
          ? String(
              req.body
                .leaveType
            )
              .trim()
              .toLowerCase()
          : policy.leaveType;

      const gradeQuotas =
        req.body.gradeQuotas !==
        undefined
          ? normalizeGradeQuotas(
              req.body
                .gradeQuotas
            )
          : policy.gradeQuotas.map(
              (row) => ({
                gradeId:
                  String(
                    row.gradeId
                  ),

                yearlyQuota:
                  Number(
                    row.yearlyQuota
                  ),
              })
            );

      await validateGrades(
        gradeQuotas
      );

      const applicableRole =
        req.body
          .applicableRole !==
        undefined
          ? req.body
              .applicableRole
          : policy
              .applicableRole;

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

      let approvalRouting = {
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
            finalApprovalMode
          );
      }

      if (
        finalApprovalMode
      ) {
        approvalRouting
          .approverIds =
          [];
      }

      if (
        !finalApprovalMode &&
        approvalRouting
          .approverIds
          .length === 0
      ) {
        throw new ValidationError(
          'Select at least one Manager or use Assigned Manager Final.'
        );
      }

      await validateManagers(
        approvalRouting
          .approverIds
      );

      await noDuplicate({
        leaveType,
        applicableRole,
        gradeQuotas,
        approvalRouting,
        excludeId:
          policy._id,
      });

      policy.leaveType =
        leaveType;

      policy.gradeQuotas =
        gradeQuotas;

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
          `Updated ${policy.leaveType} policy for ${gradeQuotas.length} grade(s)`,
      });

      const populated =
        await LeavePolicy
          .findById(
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
      _req,
      res
    ) => {
      const managers =
        await getEligibleApprovers();

      res.json({
        success: true,

        data:
          managers.map(
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
