const mongoose = require('mongoose');

const approvalSchema = new mongoose.Schema({
  approver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  approverRole: {
    type: String,
    enum: ['Team Lead', 'Manager', 'HR Manager', 'Admin'],
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'skipped'],
    default: 'pending',
  },
  comment: { type: String, default: '' },
  actedAt: { type: Date },
  order: { type: Number, required: true },
}, { _id: false });

const leaveRequestSchema = new mongoose.Schema({
  employee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
  },
  leaveType: {
    type: String,
    enum: ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity', 'bereavement', 'marriage'],
    required: true,
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  session: {
    type: String,
    enum: ['full_day', 'first_half', 'second_half'],
    default: 'full_day',
  },
  endSession: {
    type: String,
    enum: ['full_day', 'first_half', 'second_half'],
    default: 'full_day',
  },
  reason: { type: String, required: true, trim: true },
  attachment: {
    url: { type: String, default: '' },
    publicId: { type: String, default: '' },
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'withdrawn'],
    default: 'pending',
  },
  currentStage: {
    type: Number,
    default: 0,
  },
  approvals: [approvalSchema],
  totalDays: { type: Number, required: true, default: 0 },
  isPaid: { type: Boolean, default: true },
  approverComment: { type: String, default: '' },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
  },
  cancelledReason: { type: String, default: '' },
  history: [{
    action: { type: String, enum: ['created', 'approved', 'rejected', 'cancelled', 'withdrawn', 'forwarded'] },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    comment: String,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

leaveRequestSchema.index({ employee: 1, status: 1 });
leaveRequestSchema.index({ status: 1, startDate: 1 });
leaveRequestSchema.index({ 'approvals.approver': 1, 'approvals.status': 1 });

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
