const mongoose = require('mongoose');

const leaveTypeSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity', 'bereavement', 'marriage'],
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  defaultDays: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  isPaid: {
    type: Boolean,
    default: true,
  },
  carryForward: {
    type: Boolean,
    default: false,
  },
  maxCarryForward: {
    type: Number,
    default: 0,
  },
  requiresAttachment: {
    type: Boolean,
    default: false,
  },
  isHalfDayAllowed: {
    type: Boolean,
    default: true,
  },
  applicableGenders: {
    type: [String],
    enum: ['male', 'female', 'other'],
    default: ['male', 'female', 'other'],
  },
}, { _id: false });

const leavePolicySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  grade: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Grade',
    required: true,
    unique: true,
  },
  leaveTypes: [leaveTypeSchema],
  weekendPolicy: {
    type: String,
    enum: ['saturday_sunday', 'sunday_only', 'friday_saturday'],
    default: 'saturday_sunday',
  },
  publicHolidays: [{
    name: String,
    date: Date,
  }],
}, { timestamps: true });

module.exports = mongoose.model('LeavePolicy', leavePolicySchema);
