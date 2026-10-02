import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.2
const gradeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // null = legacy shared master data; owned records carry the client organization.
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    annualLeaveQuota: { type: Number, required: true },
    sickLeaveQuota: { type: Number, default: 0 },
    casualLeaveQuota: { type: Number, default: 0 },
    carryForwardAllowed: { type: Boolean, default: false },
    maxCarryForwardDays: { type: Number, default: 0 },
    description: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('Grade', gradeSchema);
