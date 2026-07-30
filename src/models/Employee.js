const mongoose = require('mongoose');

const leaveBalanceSchema = new mongoose.Schema({
  leaveType: {
    type: String,
    required: true,
    enum: ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity', 'bereavement', 'marriage'],
  },
  total: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  pending: { type: Number, default: 0 },
  carryForwarded: { type: Number, default: 0 },
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  employeeId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  gender: { type: String, enum: ['male', 'female', 'other'], default: 'male' },
  dateOfBirth: { type: Date },
  joiningDate: { type: Date, required: true },
  relievingDate: { type: Date },
  status: {
    type: String,
    enum: ['active', 'inactive', 'on_leave', 'relieved', 'suspended'],
    default: 'active',
  },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  designation: { type: mongoose.Schema.Types.ObjectId, ref: 'Designation', default: null },
  grade: { type: mongoose.Schema.Types.ObjectId, ref: 'Grade', default: null },
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
  manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  teamLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },
  emergencyContact: {
    name: String,
    relationship: String,
    phone: String,
  },
  avatar: { type: String, default: '' },
  leaveBalance: [leaveBalanceSchema],
  leavePolicy: { type: mongoose.Schema.Types.ObjectId, ref: 'LeavePolicy', default: null },
  lastActiveAt: { type: Date, default: Date.now },
}, { timestamps: true });

employeeSchema.index({ manager: 1 });
employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
