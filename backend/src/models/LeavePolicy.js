import mongoose from 'mongoose';

const { Schema } = mongoose;

const leavePolicySchema = new Schema(
  {
    // Dynamic leave type: annual, sick, maternity, marriage, custom, etc.
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
     * POLICY-DRIVEN YEARLY QUOTA
     *
     * This is the yearly entitlement for the applicant scope below.
     * Example:
     * annual + Grade A = 20
     * annual + Grade B = 15
     * maternity + Grade A = 90
     *
     * Balance rows are created per employee + leaveType + year.
     */
    yearlyQuota: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    isPaid: {
      type: Boolean,
      default: true,
    },

    // Kept only for backwards compatibility. UI no longer uses it.
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

    adminOnlyApproval: {
      type: Boolean,
      default: false,
    },

    finalApprovalMode: {
      type: Boolean,
      default: false,
    },

    approvalRouting: {
      // Applicant scope
      designation: {
        type: String,
        default: null,
      },

      department: {
        type: String,
        default: null,
      },

      // Grade MongoDB ID. null means All Grades.
      grade: {
        type: String,
        default: null,
      },

      // Manual approval chain when not Admin Only / Final Manager.
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
  'approvalRouting.grade': 1,
  'approvalRouting.department': 1,
  'approvalRouting.designation': 1,
});

export default mongoose.model(
  'LeavePolicy',
  leavePolicySchema
);
