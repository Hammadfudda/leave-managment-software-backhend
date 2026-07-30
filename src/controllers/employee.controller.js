const crypto = require('crypto');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Role = require('../models/Role');
const { AppError, NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');
const { sendWelcomeEmail } = require('../services/emailService');
const { initializeLeaveBalance } = require('../utils/leaveBalance');

function generateTempPassword(length = 12) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

exports.createEmployee = asyncHandler(async (req, res) => {
  const {
    firstName, lastName, email, phone, gender, dateOfBirth,
    joiningDate, department, designation, grade, roleName = 'Employee',
    manager, teamLead, address, emergencyContact, employeeId,
  sendInvite = true,
  leavePolicyId,
  password,
  ...rest
  } = req.body;

  if (!firstName || !lastName || !email || !employeeId || !joiningDate) {
    throw new ValidationError('firstName, lastName, email, employeeId, joiningDate are required.');
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) throw new ConflictError('Email already in use.');

  const existingEmp = await Employee.findOne({ employeeId });
  if (existingEmp) throw new ConflictError('Employee ID already exists.');

  const role = await Role.findOne({ name: roleName });
  if (!role) throw new ValidationError(`Role '${roleName}' not found. Create the role first.`);

  const tempPassword = password || generateTempPassword();
  const user = await User.create({ email, password: tempPassword, role: roleName });

  const employee = await Employee.create({
    user: user._id,
    employeeId,
    firstName, lastName, email, phone, gender, dateOfBirth,
    joiningDate,
    department, designation, grade,
    role: role._id,
    manager, teamLead,
    address, emergencyContact,
    leavePolicy: leavePolicyId || null,
    ...rest,
  });

  if (leavePolicyId) {
    await initializeLeaveBalance(employee._id);
  }

  if (sendInvite) {
    await sendWelcomeEmail(email, `${firstName} ${lastName}`, tempPassword);
  }

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'create_employee',
    target: employee._id,
    targetModel: 'Employee',
    description: `Employee ${firstName} ${lastName} created`,
    req,
  });

  res.status(201).json({
    status: 'success',
    message: 'Employee created successfully.',
    data: employee,
  });
});

exports.getEmployees = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 20, search, department, status, manager, grade, sortBy = 'createdAt', order = 'desc',
  } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { employeeId: { $regex: search, $options: 'i' } },
    ];
  }
  if (department) filter.department = department;
  if (status) filter.status = status;
  if (manager) filter.manager = manager;
  if (grade) filter.grade = grade;

  // Team Leads / Managers see only their team
  const roleName = req.employee?.role?.name || req.user?.role;
  if (roleName === 'Team Lead') {
    filter.teamLead = req.employee._id;
  } else if (roleName === 'Manager') {
    filter.manager = req.employee._id;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sortOrder = order === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const [employees, total] = await Promise.all([
    Employee.find(filter)
      .populate('department designation grade role manager teamLead')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit)),
    Employee.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      employees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

exports.getEmployeeById = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id)
    .populate('department designation grade role manager teamLead leavePolicy');

  if (!employee) throw new NotFoundError('Employee');

  // Access control: employees can view their own; managers can view team
  const requesterRole = req.employee?.role?.name || req.user?.role;
  const isSelf = req.employee._id.toString() === employee._id.toString();
  const isManager = employee.manager && employee.manager._id.toString() === req.employee._id.toString();
  const isTeamLead = employee.teamLead && employee.teamLead._id.toString() === req.employee._id.toString();
  const isPrivileged = ['Super Admin', 'Admin', 'HR Manager'].includes(requesterRole);

  if (!isSelf && !isManager && !isTeamLead && !isPrivileged) {
    throw new AppError('You do not have access to this employee profile.', 403);
  }

  res.status(200).json({ status: 'success', data: { employee } });
});

exports.updateEmployee = asyncHandler(async (req, res) => {
  const updates = { ...req.body };
  const restricted = ['user', 'employeeId', '_id', '__v'];
  restricted.forEach((f) => delete updates[f]);

  const employee = await Employee.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).populate('department designation grade role manager teamLead');

  if (!employee) throw new NotFoundError('Employee');

  if (updates.role) {
    const role = await Role.findById(updates.role);
    if (role) {
      await User.findByIdAndUpdate(employee.user, { role: role.name });
    }
  }

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'update_employee',
    target: employee._id,
    targetModel: 'Employee',
    description: `Employee ${employee.firstName} ${employee.lastName} updated`,
    req,
  });

  res.status(200).json({ status: 'success', message: 'Employee updated.', data: { employee } });
});

exports.deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) throw new NotFoundError('Employee');

  employee.status = 'inactive';
  employee.relievingDate = new Date();
  await employee.save();

  await User.findByIdAndUpdate(employee.user, { isActive: false });

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'delete_employee',
    target: employee._id,
    targetModel: 'Employee',
    description: `Employee ${employee.firstName} ${employee.lastName} deactivated`,
    req,
  });

  res.status(200).json({ status: 'success', message: 'Employee deactivated.' });
});

exports.getMyTeam = asyncHandler(async (req, res) => {
  const filter = {
    $or: [
      { manager: req.employee._id },
      { teamLead: req.employee._id },
    ],
  };
  const team = await Employee.find(filter).populate('department designation grade role').sort('firstName');
  res.status(200).json({ status: 'success', data: { team, count: team.length } });
});

exports.importCSV = asyncHandler(async (req, res) => {
  if (!req.file) throw new ValidationError('CSV file required.');
  const csv = require('csv-parser');
  const results = [];
  const bufferStream = require('stream').Readable.from(req.file.buffer);

  await new Promise((resolve, reject) => {
    bufferStream
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  let created = 0;
  let failed = 0;
  const errors = [];

  for (const row of results) {
    try {
      const email = row.email?.trim();
      const employeeId = row.employeeId?.trim() || row.employee_id?.trim();
      const firstName = row.firstName?.trim() || row.first_name?.trim();
      const lastName = row.lastName?.trim() || row.last_name?.trim();
      const joiningDate = row.joiningDate || row.joining_date;

      if (!email || !employeeId || !firstName || !lastName || !joiningDate) {
        failed += 1;
        errors.push(`Row missing required fields: ${JSON.stringify(row)}`);
        continue;
      }

      const exists = await User.findOne({ email }) || await Employee.findOne({ employeeId });
      if (exists) {
        failed += 1;
        errors.push(`Duplicate: ${email} / ${employeeId}`);
        continue;
      }

      const role = await Role.findOne({ name: row.role || 'Employee' });
      const tempPassword = generateTempPassword();
      const user = await User.create({ email, password: tempPassword, role: row.role || 'Employee' });
      await Employee.create({
        user: user._id,
        employeeId, firstName, lastName, email,
        joiningDate,
        role: role?._id,
        phone: row.phone,
        gender: row.gender,
      });
      created += 1;
    } catch (err) {
      failed += 1;
      errors.push(`Error: ${err.message}`);
    }
  }

  await logAudit({
    actor: req.employee?._id,
    actorRole: req.employee?.role?.name,
    action: 'csv_import',
    description: `CSV import: ${created} created, ${failed} failed`,
    metadata: { created, failed },
    req,
  });

  res.status(200).json({
    status: 'success',
    message: `Imported ${created} employees. ${failed} failed.`,
    data: { created, failed, errors },
  });
});

exports.getMyProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.employee._id)
    .populate('department designation grade role manager teamLead leavePolicy');
  res.status(200).json({ status: 'success', data: { employee } });
});
