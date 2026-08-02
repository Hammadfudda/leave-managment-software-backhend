import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.9
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: String,
    action: { type: String, required: true }, // see Part 8.3 for the full action vocabulary
    targetType: String,
    targetId: Schema.Types.ObjectId,
    details: String,
    affectedPerson: String,
    department: String,
    leaveType: String,
    comment: String,
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actorId: 1 });

export default mongoose.model('AuditLog', auditLogSchema);
