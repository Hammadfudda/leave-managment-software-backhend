const Designation = require('../models/Designation');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');

exports.createDesignation = asyncHandler(async (req, res) => {
  const { name, department, description } = req.body;
  if (!name) throw new ValidationError('Designation name is required.');

  const existing = await Designation.findOne({ name });
  if (existing) throw new ConflictError('Designation name already exists.');

  const designation = await Designation.create({ name, department, description });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_designation', target: designation._id, targetModel: 'Designation', description: `Designation ${name} created`, req });
  res.status(201).json({ status: 'success', message: 'Designation created.', data: { designation } });
});

exports.getDesignations = asyncHandler(async (req, res) => {
  const { department } = req.query;
  const filter = department ? { department } : {};
  const designations = await Designation.find(filter).populate('department', 'name').sort('name');
  res.status(200).json({ status: 'success', data: { designations, count: designations.length } });
});

exports.getDesignationById = asyncHandler(async (req, res) => {
  const designation = await Designation.findById(req.params.id).populate('department', 'name');
  if (!designation) throw new NotFoundError('Designation');
  res.status(200).json({ status: 'success', data: { designation } });
});

exports.updateDesignation = asyncHandler(async (req, res) => {
  const designation = await Designation.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true }).populate('department', 'name');
  if (!designation) throw new NotFoundError('Designation');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_designation', target: designation._id, targetModel: 'Designation', description: `Designation ${designation.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Designation updated.', data: { designation } });
});

exports.deleteDesignation = asyncHandler(async (req, res) => {
  const designation = await Designation.findByIdAndDelete(req.params.id);
  if (!designation) throw new NotFoundError('Designation');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_designation', target: designation._id, targetModel: 'Designation', description: `Designation ${designation.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Designation deleted.' });
});
