import mongoose from 'mongoose';

const { Schema } = mongoose;

// Spec Part 2.8
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: [
        'leave_submitted',
        'leave_pending_approval',
        'leave_approved',
        'leave_rejected',
        'leave_cancelled',
        'extension_requested',
        'stop_requested',
      ],
      required: true,
    },
    message: { type: String, required: true },
    relatedLeaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest' },
    isRead: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
