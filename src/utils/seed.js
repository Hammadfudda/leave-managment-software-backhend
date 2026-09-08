require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/Role');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Grade = require('../models/Grade');
const LeavePolicy = require('../models/LeavePolicy');
const Department = require('../models/Department');
const Designation = require('../models/Designation');
const connectDB = require('../config/db');

const defaultRoles = [
  {
    name: 'Super Admin',
    permissions: [
      'manage_users', 'manage_employees', 'manage_leave_policies', 'manage_departments',
      'manage_designations', 'manage_grades', 'manage_roles', 'approve_leave', 'reject_leave',
      'view_all_employees', 'view_team_employees', 'view_reports', 'view_audit_logs',
      'manage_calendar', 'request_leave', 'cancel_own_leave',
    ],
  },
  {
    name: 'Admin',
    permissions: [
      'manage_employees', 'manage_leave_policies', 'manage_departments', 'manage_designations',
      'manage_grades', 'approve_leave', 'reject_leave', 'view_all_employees', 'view_reports',
      'manage_calendar', 'request_leave', 'cancel_own_leave',
    ],
  },
  {
    name: 'HR Manager',
    permissions: [
      'manage_employees', 'manage_leave_policies', 'manage_departments', 'manage_designations',
      'manage_grades', 'approve_leave', 'reject_leave', 'view_all_employees', 'view_reports',
      'manage_calendar', 'request_leave', 'cancel_own_leave',
    ],
  },
  {
    name: 'Manager',
    permissions: ['approve_leave', 'reject_leave', 'view_team_employees', 'view_reports', 'request_leave', 'cancel_own_leave'],
  },
  {
    name: 'Team Lead',
    permissions: ['approve_leave', 'reject_leave', 'view_team_employees', 'request_leave', 'cancel_own_leave'],
  },
  {
    name: 'Employee',
    permissions: ['request_leave', 'cancel_own_leave'],
  },
];

async function seed() {
  await connectDB();
  console.log('Seeding database...');

  // Roles
  for (const r of defaultRoles) {
    await Role.findOneAndUpdate({ name: r.name }, { $set: { permissions: r.permissions } }, { upsert: true, new: true });
  }
  console.log('Roles seeded.');

  // Super Admin user
  const adminEmail = 'admin@company.com';
  let adminUser = await User.findOne({ email: adminEmail });
  if (!adminUser) {
    adminUser = await User.create({ email: adminEmail, password: 'admin123', role: 'Super Admin' });
    console.log('Super Admin user created: admin@company.com / admin123');
  }

  const superAdminRole = await Role.findOne({ name: 'Super Admin' });
  let adminEmp = await Employee.findOne({ user: adminUser._id });
  if (!adminEmp) {
    adminEmp = await Employee.create({
      user: adminUser._id,
      employeeId: 'EMP-001',
      firstName: 'Super',
      lastName: 'Admin',
      email: adminEmail,
      joiningDate: new Date(),
      role: superAdminRole._id,
    });
    console.log('Super Admin employee profile created.');
  }

  // Default grade + leave policy
  let grade = await Grade.findOne({ name: 'Default' });
  if (!grade) {
    grade = await Grade.create({ name: 'Default', level: 1, description: 'Default grade for all employees' });
    console.log('Default grade created.');
  }

  let policy = await LeavePolicy.findOne({ grade: grade._id });
  if (!policy) {
    policy = await LeavePolicy.create({
      name: 'Default Leave Policy',
      grade: grade._id,
      weekendPolicy: 'saturday_sunday',
      leaveTypes: [
        { type: 'casual', name: 'Casual Leave', defaultDays: 12, isPaid: true, carryForward: false, requiresAttachment: false, isHalfDayAllowed: true },
        { type: 'sick', name: 'Sick Leave', defaultDays: 12, isPaid: true, carryForward: true, maxCarryForward: 6, requiresAttachment: false, isHalfDayAllowed: true },
        { type: 'earned', name: 'Earned Leave', defaultDays: 15, isPaid: true, carryForward: true, maxCarryForward: 15, requiresAttachment: false, isHalfDayAllowed: true },
        { type: 'unpaid', name: 'Unpaid Leave', defaultDays: 0, isPaid: false, carryForward: false, requiresAttachment: false, isHalfDayAllowed: true },
        { type: 'maternity', name: 'Maternity Leave', defaultDays: 90, isPaid: true, carryForward: false, requiresAttachment: true, isHalfDayAllowed: false, applicableGenders: ['female'] },
        { type: 'paternity', name: 'Paternity Leave', defaultDays: 10, isPaid: true, carryForward: false, requiresAttachment: false, isHalfDayAllowed: false, applicableGenders: ['male'] },
        { type: 'bereavement', name: 'Bereavement Leave', defaultDays: 3, isPaid: true, carryForward: false, requiresAttachment: false, isHalfDayAllowed: false },
        { type: 'marriage', name: 'Marriage Leave', defaultDays: 5, isPaid: true, carryForward: false, requiresAttachment: true, isHalfDayAllowed: false },
      ],
    });
    console.log('Default leave policy created.');
  }

  // Assign policy to super admin
  if (!adminEmp.leavePolicy) {
    adminEmp.leavePolicy = policy._id;
    adminEmp.grade = grade._id;
    await adminEmp.save();
  }

  // Default department
  let dept = await Department.findOne({ name: 'Administration' });
  if (!dept) {
    dept = await Department.create({ name: 'Administration', description: 'Administration department', head: adminEmp._id });
    console.log('Default department created.');
  }

  // Default designation
  let desig = await Designation.findOne({ name: 'Administrator' });
  if (!desig) {
    desig = await Designation.create({ name: 'Administrator', department: dept._id, description: 'System administrator' });
    console.log('Default designation created.');
  }

  adminEmp.department = dept._id;
  adminEmp.designation = desig._id;
  await adminEmp.save();

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
