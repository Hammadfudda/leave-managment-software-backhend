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

// MongoDB Atlas SRV DNS fix
dns.setServers(['8.8.8.8', '8.8.4.4']);

/**
 * Generic upsert for non-user seed data.
 */
async function upsert(Model, where, doc) {
  const existing = await Model.findOne(where);

  if (existing) {
    Object.assign(existing, doc);
    await existing.save();
    return existing;
  }

  return Model.create({
    ...where,
    ...doc,
  });
}

/**
 * Seed user safely.
 *
 * IMPORTANT:
 * Existing user's email/password will NOT be overwritten.
 */
async function upsertSeedUser({
  grade,
  employeeId,
  defaultEmail,
  fullName,
  cnic,
  role,
  designation,
  department,
  canApproveOtherDepartments = false,
}) {
  let user = await User.findOne({ employeeId });

  // Existing user
  if (user) {
    user.fullName = fullName;

    user.nationalId =
      user.nationalId || cnic;

    user.cnic =
      user.cnic || cnic;

    user.role = role;
    user.gradeId = grade._id;
    user.designation = designation;
    user.department = department;

    user.canApproveOtherDepartments =
      canApproveOtherDepartments;

    user.status = 'active';

    if (!user.dateOfJoining) {
      user.dateOfJoining =
        new Date('2024-01-01');
    }

    await user.save();

    console.log(
      `Preserved existing ${role}: ${user.fullName} <${user.email}>`
    );

    return user;
  }

  // First time user creation
  const passwordHash =
    await bcrypt.hash(cnic, 10);

  user = await User.create({
    fullName,
    email: defaultEmail,

    nationalId: cnic,
    cnic,

    passwordHash,
    passwordChangedFromDefault: false,

    role,

    gradeId: grade._id,

    managerId: null,

    canApproveOtherDepartments,

    employeeId,
    designation,
    department,

    dateOfJoining:
      new Date('2024-01-01'),

    status: 'active',
  });

  console.log(
    `Created ${role}: ${user.fullName} <${user.email}>`
  );

  return user;
}

async function seed() {
  await connectDB();

  // ============================================================
  // GRADE
  // ============================================================

  const grade = await upsert(
    Grade,
    {
      name: 'Grade A',
    },
    {
      annualLeaveQuota: 20,
      sickLeaveQuota: 10,
      casualLeaveQuota: 8,

      carryForwardAllowed: true,
      maxCarryForwardDays: 5,

      description: 'Default grade',
    }
  );

  // ============================================================
  // DEPARTMENTS
  // ============================================================

  await upsert(
    Department,
    {
      name: 'Engineering',
    },
    {
      saturdayOff: true,
    }
  );

  await upsert(
    Department,
    {
      name: 'Operations',
    },
    {
      saturdayOff: false,
    }
  );

  // ============================================================
  // DESIGNATIONS
  // ============================================================

  const designations = [
    'Chief',
    'Senior Engineer',
    'Engineer',
    'Officer',
  ];

  for (const name of designations) {
    await upsert(
      Designation,
      { name },
      {}
    );
  }

  // ============================================================
  // ROLE LABELS
  // ============================================================

  const roleLabels = [
    'HR',
    'Finance',
    'Technical',
  ];

  for (const name of roleLabels) {
    await upsert(
      RoleLabel,
      { name },
      {}
    );
  }

  // ============================================================
  // ADMIN
  // ============================================================

  /**
   * Admin remains in User collection because the current
   * User schema requires employee-style fields.
   *
   * However:
   * - Admin will NOT receive leave balances.
   * - Admin will NOT use employee My Profile UI.
   * - Admin will NOT apply for normal leave.
   */

  const admin =
    await upsertSeedUser({
      grade,

      employeeId: 'NDD-001',

      defaultEmail:
        'admin@example.com',

      fullName:
        'System Administrator',

      cnic:
        '11111-1111111-1',

      role: 'admin',

      designation: 'Chief',

      department:
        'Engineering',
    });

  // ============================================================
  // MANAGER
  // ============================================================

  const manager =
    await upsertSeedUser({
      grade,

      employeeId: 'NDD-002',

      defaultEmail:
        'manager@example.com',

      fullName:
        'Maria Manager',

      cnic:
        '22222-2222222-2',

      role: 'manager',

      designation:
        'Senior Engineer',

      department:
        'Engineering',

      canApproveOtherDepartments:
        true,
    });

  // ============================================================
  // EMPLOYEE
  // ============================================================

  const employee =
    await upsertSeedUser({
      grade,

      employeeId: 'NDD-003',

      defaultEmail:
        'employee@example.com',

      fullName:
        'Eddie Employee',

      cnic:
        '33333-3333333-3',

      role: 'employee',

      designation:
        'Engineer',

      department:
        'Engineering',
    });

  // ============================================================
  // MANAGER RELATIONSHIPS
  // ============================================================

  // Admin has no manager.
  if (admin.managerId) {
    admin.managerId = null;
    await admin.save();
  }

  // Manager reports to Admin.
  if (
    String(manager.managerId || '') !==
    String(admin._id)
  ) {
    manager.managerId =
      admin._id;

    await manager.save();
  }

  // Employee reports to Manager.
  if (
    String(employee.managerId || '') !==
    String(manager._id)
  ) {
    employee.managerId =
      manager._id;

    await employee.save();
  }

  // ============================================================
  // LEAVE BALANCES
  // ============================================================

  /**
   * IMPORTANT:
   *
   * Admin is a system-level account and does NOT
   * receive personal leave balances.
   *
   * Only Manager + Employee participate in
   * normal leave balances.
   */

  await initializeLeaveBalances(
    manager._id,
    grade
  );

  await initializeLeaveBalances(
    employee._id,
    grade
  );

  // ============================================================
  // CORE LEAVE POLICIES
  // ============================================================

  for (const leaveType of [
    'annual',
    'sick',
    'casual',
  ]) {
    const existingPolicy =
      await LeavePolicy.findOne({
        leaveType,

        'approvalRouting.department':
          'Engineering',
      });

    const policyData = {
      applicableRole:
        'All Employees',

      isPaid: true,

      minDaysNoticeRequired: 0,

      documentRequirement:
        leaveType === 'sick'
          ? 'optional'
          : 'not_required',

      adminOnlyApproval: false,

      /**
       * Assigned Manager makes the FINAL decision.
       */
      finalApprovalMode: true,

      approvalRouting: {
        designation: null,

        department:
          'Engineering',

        grade: null,

        /**
         * Do NOT hard-code manager IDs.
         *
         * Backend resolves employee.managerId
         * when the request is created.
         */
        approverIds: [],
      },
    };

    if (existingPolicy) {
      Object.assign(
        existingPolicy,
        policyData
      );

      await existingPolicy.save();
    } else {
      await LeavePolicy.create({
        leaveType,
        ...policyData,
      });
    }
  }

  // ============================================================
  // UNPAID LEAVE
  // ============================================================

  const existingUnpaid =
    await LeavePolicy.findOne({
      leaveType: 'unpaid',
    });

  const unpaidPolicy = {
    applicableRole:
      'All Employees',

    isPaid: false,

    minDaysNoticeRequired: 0,

    documentRequirement:
      'optional',

    // Unpaid leave remains Admin-only.
    adminOnlyApproval: true,

    finalApprovalMode: false,

    approvalRouting: {
      designation: null,
      department: null,
      grade: null,
      approverIds: [],
    },
  };

  if (existingUnpaid) {
    Object.assign(
      existingUnpaid,
      unpaidPolicy
    );

    await existingUnpaid.save();
  } else {
    await LeavePolicy.create({
      leaveType: 'unpaid',
      ...unpaidPolicy,
    });
  }

  // ============================================================
  // RESULT
  // ============================================================

  console.log('');
  console.log(
    '================================'
  );
  console.log(
    'SEED COMPLETE'
  );
  console.log(
    '================================'
  );
  console.log('');

  console.log('Current users:');
  console.log('');

  console.log(
    `Admin:    ${admin.email}`
  );

  console.log(
    `Manager:  ${manager.email}`
  );

  console.log(
    `Employee: ${employee.email}`
  );

  console.log('');

  console.log(
    'Admin: system-level account (no personal leave balance).'
  );

  console.log(
    'Manager + Employee: normal leave balance users.'
  );

  console.log('');

  console.log(
    'Existing emails/passwords were preserved.'
  );

  console.log(
    'Default CNIC password is only created for new seeded users.'
  );

  console.log('');

  console.log(
    'Annual/Sick/Casual approval flow:'
  );

  console.log(
    'Employee -> Assigned Manager -> FINAL'
  );

  console.log('');

  process.exit(0);
}

seed().catch((err) => {
  console.error(
    'Seed failed:',
    err
  );

  process.exit(1);
});