import 'dotenv/config';
import dns from 'node:dns';
import bcrypt from 'bcryptjs';

import { connectDB } from './config/db.js';
import User from './models/User.js';
import Grade from './models/Grade.js';
import Department from './models/Department.js';
import Designation from './models/Designation.js';
import RoleLabel from './models/RoleLabel.js';
import LeavePolicy from './models/LeavePolicy.js';
import { initializeLeaveBalances } from './services/balance.service.js';

// Fix MongoDB Atlas SRV DNS resolution
dns.setServers(['8.8.8.8', '8.8.4.4']);

/**
 * Minimum viable starting data: one grade, one department, an Admin, a Manager
 * and an Employee, plus annual/sick/casual policies routed through the manager
 * then the admin.
 *
 * Every password is the person's CNIC.
 *
 * Safe to re-run: everything is upserted by its natural key.
 */
async function upsert(Model, where, doc) {
  const existing = await Model.findOne(where);

  if (existing) {
    Object.assign(existing, doc);
    await existing.save();
    return existing;
  }

  return Model.create({ ...where, ...doc });
}

async function seed() {
  await connectDB();

  const grade = await upsert(
    Grade,
    { name: 'Grade A' },
    {
      annualLeaveQuota: 20,
      sickLeaveQuota: 10,
      casualLeaveQuota: 8,
      carryForwardAllowed: true,
      maxCarryForwardDays: 5,
      description: 'Default grade',
    }
  );

  await upsert(
    Department,
    { name: 'Engineering' },
    { saturdayOff: true }
  );

  await upsert(
    Department,
    { name: 'Operations' },
    { saturdayOff: false }
  );

  for (const name of [
    'Chief',
    'Senior Engineer',
    'Engineer',
    'Officer',
  ]) {
    await upsert(Designation, { name }, {});
  }

  for (const name of ['HR', 'Finance', 'Technical']) {
    await upsert(RoleLabel, { name }, {});
  }

  const people = [
    {
      fullName: 'System Administrator',
      email: 'admin@example.com',
      cnic: '11111-1111111-1',
      employeeId: 'NDD-001',
      role: 'admin',
      designation: 'Chief',
      department: 'Engineering',
    },
    {
      fullName: 'Maria Manager',
      email: 'manager@example.com',
      cnic: '22222-2222222-2',
      employeeId: 'NDD-002',
      role: 'manager',
      designation: 'Senior Engineer',
      department: 'Engineering',
      canApproveOtherDepartments: true,
    },
    {
      fullName: 'Eddie Employee',
      email: 'employee@example.com',
      cnic: '33333-3333333-3',
      employeeId: 'NDD-003',
      role: 'employee',
      designation: 'Engineer',
      department: 'Engineering',
    },
  ];

  const created = {};

  for (const person of people) {
    const user = await upsert(
      User,
      { email: person.email },
      {
        ...person,
        nationalId: person.cnic,
        passwordHash: await bcrypt.hash(person.cnic, 10),
        passwordChangedFromDefault: false,
        gradeId: grade._id,
        dateOfJoining: new Date('2024-01-01'),
        status: 'active',
      }
    );

    created[person.role] = user;

    await initializeLeaveBalances(user._id, grade);
  }

  // Manager reports to Admin
  created.manager.managerId = created.admin._id;
  await created.manager.save();

  // Employee reports to Manager
  created.employee.managerId = created.manager._id;
  await created.employee.save();

  // Leave approval routing
  for (const leaveType of ['annual', 'sick', 'casual']) {
    await upsert(
      LeavePolicy,
      {
        leaveType,
        'approvalRouting.department': 'Engineering',
      },
      {
        applicableRole: 'All Employees',
        isPaid: true,
        minDaysNoticeRequired: leaveType === 'annual' ? 7 : 0,
        documentRequirement:
          leaveType === 'sick'
            ? 'optional'
            : 'not_required',

        approvalRouting: {
          designation: null,
          department: 'Engineering',
          grade: null,
          approverIds: [
            created.manager._id,
            created.admin._id,
          ],
        },
      }
    );
  }

  // Admin-only unpaid leave
  await upsert(
    LeavePolicy,
    { leaveType: 'unpaid' },
    {
      applicableRole: 'All Employees',
      isPaid: false,
      minDaysNoticeRequired: 0,
      documentRequirement: 'optional',
      adminOnlyApproval: true,

      approvalRouting: {
        designation: null,
        department: null,
        grade: null,
        approverIds: [],
      },
    }
  );

  console.log('');
  console.log('Seed complete. Log in with any of:');

  for (const p of people) {
    console.log(`  ${p.email} / ${p.cnic}`);
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});