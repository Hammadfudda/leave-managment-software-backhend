import mongoose from 'mongoose';

import {
  tenantPlugin,
} from '../utils/tenantPlugin.js';

import {
  getTenantOrganizationId,
} from '../utils/tenantContext.js';

const { Schema } = mongoose;

const gradeQuotaSchema = new Schema(
  {
    gradeId: {
      type: Schema.Types.ObjectId,
      ref: 'Grade',
      required: true,
    },

    yearlyQuota: {
      type: Number,
      required: true,
      min: 0.5,
    },
  },
  {
    _id: false,
  }
);

const leavePolicySchema = new Schema(
  {
    leaveType: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    /*
     * LEGACY COMPATIBILITY:
     * Kept in schema so existing DB records / older code are not destroyed.
     * New UI always uses "All Employees" and does not expose this field.
     */
    applicableRole: {
      type: String,
      enum: [
        'All Employees',
        'employee',
        'manager',
        'admin',
      ],
      default: 'All Employees',
    },
    /*
     * FINAL SOURCE OF LEAVE ENTITLEMENT.
     *
     * Example:
     * Annual Leave:
     * Grade A -> 14
     * Grade B -> 18
     */
    gradeQuotas: {
      type: [gradeQuotaSchema],
      required: true,
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length > 0
          );
        },
        message:
          'At least one grade and yearly quota is required.',
      },
    },
    isPaid: {
      type: Boolean,
      default: true,
    },

    /*
     * Kept only for backward compatibility.
     * New UI does not expose Notice Days.
     */
    minDaysNoticeRequired: {
      type: Number,
      default: 0,
    },

    documentRequirement: {
      type: String,
      enum: [
        'required',
        'optional',
        'not_required',
      ],
      default: 'optional',
    },
    /*
     * Carry-forward belongs to Leave Policy, not Grade.
     */
    carryForwardAllowed: {
      type: Boolean,
      default: false,
    },

    maxCarryForwardDays: {
      type: Number,
      min: 0,
      default: 0,
    },

    /*
     * true:
     * Employee's assigned Manager is final approver.
     *
     * false:
     * Manual Manager Approval Chain.
     */
    finalApprovalMode: {
      type: Boolean,
      default: true,
    },
    /*
     * department/designation are kept ONLY so old DB documents stay readable.
     * New UI/controller writes them as null.
     */
    approvalRouting: {
      designation: {
        type: String,
        default: null,
      },

      department: {
        type: String,
        default: null,
      },

      approverIds: [
        {
          type: Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
    },
    /*
     * Legacy compatibility for old requests/controllers.
     * New Leave Policy UI never enables admin-only approval.
     */
    adminOnlyApproval: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

leavePolicySchema.plugin(tenantPlugin);

/*
 * Current index preserved, with organizationId added in front.
 */
leavePolicySchema.index({
  organizationId: 1,
  leaveType: 1,
  applicableRole: 1,
  'approvalRouting.department': 1,
  'approvalRouting.designation': 1,
});

const LeavePolicy = mongoose.model(
  'LeavePolicy',
  leavePolicySchema
);

/*
|--------------------------------------------------------------------------
| TENANT-SAFE DISTINCT
|--------------------------------------------------------------------------
|
| Mongoose 8 does not provide query middleware for Model.distinct().
| Existing employee CSV export uses LeavePolicy.distinct('leaveType').
| Wrap the model method directly so that call stays tenant-safe without
| rewriting the 2,000+ line employee controller.
|
*/
const mongooseDistinct =
  LeavePolicy.distinct.bind(
    LeavePolicy
  );

LeavePolicy.distinct = function tenantSafeDistinct(
  field,
  conditions = {}
) {
  const tenantId =
    getTenantOrganizationId();

  if (tenantId === undefined) {
    return mongooseDistinct(
      field,
      conditions
    );
  }

  const organizationId =
    tenantId === null
      ? null
      : new mongoose.Types.ObjectId(
          tenantId
        );

  return mongooseDistinct(
    field,
    {
      $and: [
        conditions || {},
        {
          organizationId,
        },
      ],
    }
  );
};

export default LeavePolicy;
