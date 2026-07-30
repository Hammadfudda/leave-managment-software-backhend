const Role = require('../models/Role');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');

exports.createRole = asyncHandler(async (req, res) => {
  const { name, permissions } = req.body;
  if (!name) throw new ValidationError('Role name is required.');

  const existing = await Role.findOne({ name });
  if (existing) throw new ConflictError('Role name already exists.');

  const role = await Role.create({ name, permissions: permissions || [] });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_role', target: role._id, targetModel: 'Role', description: `Role ${name} created`, req });
  res.status(201).json({ status: 'success', message: 'Role created.', data: { role } });
});

exports.getRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find().sort('name');
  res.status(200).json({ status: 'success', data: { roles, count: roles.length } });
});

exports.getRoleById = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);
  if (!role) throw new NotFoundError('Role');
  res.status(200).json({ status: 'success', data: { role } });
});

exports.updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!role) throw new NotFoundError('Role');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_role', target: role._id, targetModel: 'Role', description: `Role ${role.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Role updated.', data: { role } });
});

exports.deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);
  if (!role) throw new NotFoundError('Role');

  // Prevent deleting built-in critical roles
  if (['Super Admin', 'Admin', 'Employee'].includes(role.name)) {
    throw new ConflictError(`Cannot delete built-in role: ${role.name}`);
  }

  await Role.findByIdAndDelete(req.params.id);
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_role', target: role._id, targetModel: 'Role', description: `Role ${role.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Role deleted.' });
});
