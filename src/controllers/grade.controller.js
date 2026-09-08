const Grade = require('../models/Grade');
const { NotFoundError, ValidationError, ConflictError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');

exports.createGrade = asyncHandler(async (req, res) => {
  const { name, level, description } = req.body;
  if (!name || !level) throw new ValidationError('Name and level are required.');

  const existing = await Grade.findOne({ name });
  if (existing) throw new ConflictError('Grade name already exists.');

  const grade = await Grade.create({ name, level, description });
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'create_grade', target: grade._id, targetModel: 'Grade', description: `Grade ${name} created`, req });

  res.status(201).json({ status: 'success', message: 'Grade created.', data: { grade } });
});

exports.getGrades = asyncHandler(async (req, res) => {
  const grades = await Grade.find().sort('level');
  res.status(200).json({ status: 'success', data: { grades, count: grades.length } });
});

exports.getGradeById = asyncHandler(async (req, res) => {
  const grade = await Grade.findById(req.params.id);
  if (!grade) throw new NotFoundError('Grade');
  res.status(200).json({ status: 'success', data: { grade } });
});

exports.updateGrade = asyncHandler(async (req, res) => {
  const grade = await Grade.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
  if (!grade) throw new NotFoundError('Grade');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'update_grade', target: grade._id, targetModel: 'Grade', description: `Grade ${grade.name} updated`, req });
  res.status(200).json({ status: 'success', message: 'Grade updated.', data: { grade } });
});

exports.deleteGrade = asyncHandler(async (req, res) => {
  const grade = await Grade.findByIdAndDelete(req.params.id);
  if (!grade) throw new NotFoundError('Grade');
  await logAudit({ actor: req.employee?._id, actorRole: req.employee?.role?.name, action: 'delete_grade', target: grade._id, targetModel: 'Grade', description: `Grade ${grade.name} deleted`, req });
  res.status(200).json({ status: 'success', message: 'Grade deleted.' });
});
