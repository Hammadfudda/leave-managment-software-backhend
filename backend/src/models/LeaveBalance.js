import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Per-employee, per-leave-type balance ledger.
 *
 * The spec references initializeLeaveBalances / getLeaveBalancesForUser /
 * deductLeaveBalance / restoreLeaveBalance (Parts 5.4, 7.2, 10.1) without
 * pinning a schema, so this is the concrete backing store for them.
 *
 * `quota` is seeded from the employee's Grade at creation. `used` is the only
 * field mutated by approvals; `remaining` is always derived (quota - used) and
 * never stored, so the two can never drift apart.
 */
const leaveBalanceSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    leaveType: { type: String, required: true }, // 'annual' | 'sick' | 'casual' | custom
    quota: { type: Number, required: true, default: 0 },
    used: { type: Number, required: true, default: 0 },
    year: { type: Number, default: () => new Date().getFullYear() },
  },
  { timestamps: true }
);

leaveBalanceSchema.index({ employeeId: 1, leaveType: 1, year: 1 }, { unique: true });

export default mongoose.model('LeaveBalance', leaveBalanceSchema);
