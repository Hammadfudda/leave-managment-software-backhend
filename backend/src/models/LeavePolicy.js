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
      min: 0,
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
     * MULTIPLE GRADES PER POLICY.
     *
     * Example:
     * Annual Leave
     * Grade A -> 20 days/year
     * Grade B -> 15 days/year
     * Grade C -> 12 days/year
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
     * Admin-only Leave Policy option REMOVED.
     *
     * true:
     *   employee's assigned manager is the final approver.
     *
     * false:
     *   use approvalRouting.approverIds.
     *   Those IDs must be active Managers only.
     */
    finalApprovalMode: {
      type: Boolean,
      default: true,
    },

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
          type:
            Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

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
