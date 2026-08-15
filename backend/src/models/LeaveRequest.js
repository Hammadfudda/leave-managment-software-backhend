import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.7
const leaveRequestSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    employeeName: String,
    department: String,
    leaveType: { type: String, required: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    totalDaysRequested: { type: Number, required: true }, // raw calendar days
    totalWorkingDays: { type: Number, required: true }, // after weekend exclusion — this is what's deducted
    excludedWeekendDates: [{ type: String }], // ISO dates dropped from the count, for display

    reason: { type: String, required: true },
    attachmentUrl: { type: String },
    attachmentName: { type: String },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },

    // Sequential approval tracking — see Part 5.
    requiredApproverIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    approvedByIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    rejectedByIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    // ADDENDUM 2.1 — copied from policy.adminOnlyApproval at submission time.
    // When true, requiredApproverIds is empty BY DESIGN and the request must
    // NOT auto-approve: it sits at 'pending' until an Admin decides it.
    isAdminOnlyDecision: { type: Boolean, default: false },

    approvalHistory: [
      {
        approverId: { type: Schema.Types.ObjectId, ref: 'User' },
        approverName: String,
        approverRole: String,
        action: { type: String, enum: ['approved', 'rejected', 'cancelled'] },
        comment: String,
        actionDate: { type: Date, default: Date.now },
      },
    ],

    // Extension requests — see Part 7.1. A brand new LeaveRequest document, not
    // a mutation of the original.
    isExtension: { type: Boolean, default: false },
    originalRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest', default: null },
    isPaidOverride: { type: Boolean, default: null },

    // Stop-early requests — see Part 7.2. Also a brand new document.
    isStopRequest: { type: Boolean, default: false },

    // Populated once a stop-request against this original request is approved.
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledByName: String,
    cancelledReason: String,
    daysUsedBeforeCancel: Number,
    actualEndDate: Date,
  },
  { timestamps: true }
);

leaveRequestSchema.index({ employeeId: 1, status: 1 });
leaveRequestSchema.index({ requiredApproverIds: 1, status: 1 });
leaveRequestSchema.index({ originalRequestId: 1 });
leaveRequestSchema.index({ isAdminOnlyDecision: 1, status: 1 });

export default mongoose.model('LeaveRequest', leaveRequestSchema);
