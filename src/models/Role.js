const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    enum: ['Super Admin', 'Admin', 'HR Manager', 'Manager', 'Team Lead', 'Employee'],
  },
  permissions: [{
    type: String,
    enum: [
      'manage_users',
      'manage_employees',
      'manage_leave_policies',
      'manage_departments',
      'manage_designations',
      'manage_grades',
      'manage_roles',
      'approve_leave',
      'reject_leave',
      'view_all_employees',
      'view_team_employees',
      'view_reports',
      'view_audit_logs',
      'manage_calendar',
      'request_leave',
      'cancel_own_leave',
    ],
  }],
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);
