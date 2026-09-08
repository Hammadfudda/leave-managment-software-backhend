const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  type: {
    type: String,
    enum: [
      'leave_request_submitted',
      'leave_approved',
      'leave_rejected',
      'leave_cancelled',
      'leave_reminder',
      'approval_pending',
      'password_changed',
      'welcome',
      'general',
    ],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedLeave: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LeaveRequest',
    default: null,
  },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  channel: {
    type: String,
    enum: ['in_app', 'email', 'both'],
    default: 'in_app',
  },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
