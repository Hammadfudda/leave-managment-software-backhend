import mongoose from 'mongoose';

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

/*
 * No unique index on leaveType here.
 * This avoids startup/index errors if old DB records contain more than
 * one policy for the same leave type.
 * The new controller prevents creating another policy for the same type.
 */
leavePolicySchema.index({
  leaveType: 1,
  applicableRole: 1,
  'approvalRouting.department': 1,
  'approvalRouting.designation': 1,
});

export default mongoose.model(
  'LeavePolicy',
  leavePolicySchema
);
