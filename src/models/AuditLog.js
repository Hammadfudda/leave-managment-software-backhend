const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null,
  },
  actorRole: { type: String },
  action: {
    type: String,
    required: true,
    enum: [
      'login',
      'logout',
      'create_employee',
      'update_employee',
      'delete_employee',
      'purge_employee',
      'create_leave_policy',
      'update_leave_policy',
      'delete_leave_policy',
      'create_leave_request',
      'approve_leave',
      'reject_leave',
      'cancel_leave',
      'withdraw_leave',
      'create_department',
      'update_department',
      'delete_department',
      'create_designation',
      'update_designation',
      'delete_designation',
      'create_grade',
      'update_grade',
      'delete_grade',
      'create_role',
      'update_role',
      'delete_role',
      'create_holiday',
      'update_holiday',
      'delete_holiday',
      'password_change',
      'role_change',
      'csv_import',
      'settings_update',
    ],
  },
  target: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'targetModel',
    default: null,
  },
  targetModel: {
    type: String,
    enum: ['Employee', 'LeaveRequest', 'LeavePolicy', 'Department', 'Designation', 'Grade', 'Role', 'Holiday', null],
    default: null,
  },
  description: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
