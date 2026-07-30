const Department = require('../models/Department');
const Employee = require('../models/Employee');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');

exports.createDepartment = asyncHandler(async (req, res) => {
  const { name, description, head } = req.body;
  if (!name) throw new ValidationError('Department name is required.');

  const existing = await Department.findOne({ name });
  if (existing) throw new ConflictError('Department name already exists.');

  if (head) {
    const emp = await Employee.findById(head);
    if (!emp) throw new NotFoundError('Employee (head)');
  }

  const department = await Department.create({ name, description, head });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_department', target: department._id, targetModel: 'Department', description: `Department ${name} created`, req });
  res.status(201).json({ status: 'success', message: 'Department created.', data: { department } });
});

exports.getDepartments = asyncHandler(async (req, res) => {
  const departments = await Department.find().populate('head', 'firstName lastName email').sort('name');
  res.status(200).json({ status: 'success', data: { departments, count: departments.length } });
});

exports.getDepartmentById = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id).populate('head', 'firstName lastName email');
  if (!department) throw new NotFoundError('Department');
  res.status(200).json({ status: 'success', data: { department } });
});

exports.updateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).populate('head', 'firstName lastName email');
  if (!department) throw new NotFoundError('Department');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_department', target: department._id, targetModel: 'Department', description: `Department ${department.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Department updated.', data: { department } });
});

exports.deleteDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw new NotFoundError('Department');

  const count = await Employee.countDocuments({ department: department._id, status: 'active' });
  if (count > 0) throw new ConflictError(`Cannot delete: ${count} active employees are assigned to this department.`);

  await Department.findByIdAndDelete(req.params.id);
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_department', target: department._id, targetModel: 'Department', description: `Department ${department.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Department deleted.' });
});
