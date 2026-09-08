import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.6
const leavePolicySchema = new Schema(
  {
    // 'annual' | 'sick' | 'casual' | 'unpaid' | 'maternity' | 'paternity' | custom
    leaveType: { type: String, required: true },
    applicableRole: {
      type: String,
      enum: ['All Employees', 'employee', 'manager', 'admin'],
      default: 'All Employees',
    },
    isPaid: { type: Boolean, default: true },
    // advisory only, never blocks submission
    minDaysNoticeRequired: { type: Number, default: 0 },
    documentRequirement: {
      type: String,
      enum: ['required', 'optional', 'not_required'],
      default: 'optional',
    },

    // ADDENDUM 2.1 — when true this leave type has NO approval chain at all.
    // It is decided directly and solely by an Admin, and approvalRouting
    // .approverIds is ignored (and forced empty by the controller).
    adminOnlyApproval: { type: Boolean, default: false },

    // FINAL MANAGER APPROVAL — when true, approvalRouting.approverIds is
    // ignored entirely. At submission time the single required approver is
    // resolved dynamically from the applicant's own employee.managerId, and
    // that manager's decision is final (no second tier, no admin step).
    // Completely independent of adminOnlyApproval.
    finalApprovalMode: { type: Boolean, default: false },

    approvalRouting: {
      // These three describe WHO THIS POLICY APPLIES TO (the applicant scope).
      // They are completely independent of approverIds below — do not let one
      // influence the other. An earlier draft of this feature conflated the two
      // and it was a real, shipped bug; do not repeat it.
      designation: { type: String, default: null },
      department: { type: String, default: null },
      grade: { type: String, default: null },

      // WHO APPROVES IT. Ordered array — index 0 is the gatekeeper who must act
      // first; the rest form a parallel tier that only activates once the
      // gatekeeper has approved. See Part 5.
      approverIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
  },
  { timestamps: true }
);

export default mongoose.model('LeavePolicy', leavePolicySchema);
