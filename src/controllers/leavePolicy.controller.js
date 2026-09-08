const LeavePolicy = require('../models/LeavePolicy');
const Grade = require('../models/Grade');
const Employee = require('../models/Employee');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');
const { initializeLeaveBalance } = require('../utils/leaveBalance');

exports.createLeavePolicy = asyncHandler(async (req, res) => {
  const { name, grade, leaveTypes, weekendPolicy, publicHolidays } = req.body;
  if (!name || !grade) throw new ValidationError('Name and grade are required.');

  const gradeExists = await Grade.findById(grade);
  if (!gradeExists) throw new NotFoundError('Grade');

  const existing = await LeavePolicy.findOne({ grade });
  if (existing) throw new ConflictError('A leave policy already exists for this grade.');

  const policy = await LeavePolicy.create({ name, grade, leaveTypes, weekendPolicy, publicHolidays });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_leave_policy', target: policy._id, targetModel: 'LeavePolicy', description: `Leave policy ${name} created`, req });

  // Apply to all employees with this grade
  const employees = await Employee.find({ grade, leavePolicy: { $exists: false } });
  for (const emp of employees) {
    emp.leavePolicy = policy._id;
    await emp.save();
    await initializeLeaveBalance(emp._id);
  }

  res.status(201).json({ status: 'success', message: 'Leave policy created.', data: { policy } });
});

exports.getLeavePolicies = asyncHandler(async (req, res) => {
  const policies = await LeavePolicy.find().populate('grade', 'name level').sort('name');
  res.status(200).json({ status: 'success', data: { policies, count: policies.length } });
});

exports.getLeavePolicyById = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findById(req.params.id).populate('grade', 'name level');
  if (!policy) throw new NotFoundError('Leave policy');
  res.status(200).json({ status: 'success', data: { policy } });
});

exports.updateLeavePolicy = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).populate('grade', 'name level');
  if (!policy) throw new NotFoundError('Leave policy');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_leave_policy', target: policy._id, targetModel: 'LeavePolicy', description: `Leave policy ${policy.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Leave policy updated.', data: { policy } });
});

exports.deleteLeavePolicy = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findById(req.params.id);
  if (!policy) throw new NotFoundError('Leave policy');

  const assignedCount = await Employee.countDocuments({ leavePolicy: policy._id });
  if (assignedCount > 0) throw new ConflictError(`Cannot delete: ${assignedCount} employees are assigned to this policy.`);

  await LeavePolicy.findByIdAndDelete(req.params.id);
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_leave_policy', target: policy._id, targetModel: 'LeavePolicy', description: `Leave policy ${policy.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Leave policy deleted.' });
});

exports.getMyLeavePolicy = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findById(req.employee.leavePolicy).populate('grade', 'name level');
  if (!policy) throw new NotFoundError('Leave policy');
  res.status(200).json({ status: 'success', data: { policy } });
});
