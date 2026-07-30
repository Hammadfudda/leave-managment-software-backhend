const AuditLog = require('../models/AuditLog');
const { asyncHandler } = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/errors');

exports.getAuditLogs = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 50, actor, action, startDate, endDate, sortBy = 'createdAt', order = 'desc',
  } = req.query;

  const filter = {};
  if (actor) filter.actor = actor;
  if (action) filter.action = action;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sortOrder = order === 'asc' ? 1 : -1;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actor', 'firstName lastName email employeeId')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit)),
    AuditLog.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      logs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    },
  });
});

exports.getAuditLogById = asyncHandler(async (req, res) => {
  const log = await AuditLog.findById(req.params.id).populate('actor', 'firstName lastName email employeeId');
  if (!log) throw new ValidationError('Audit log not found.', 404);
  res.status(200).json({ status: 'success', data: { log } });
});

exports.exportAuditLogsCSV = asyncHandler(async (req, res) => {
  const { Parser } = require('json2csv');
  const { action, startDate, endDate } = req.query;
  const filter = {};
  if (action) filter.action = action;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const logs = await AuditLog.find(filter).populate('actor', 'firstName lastName email employeeId').sort('-createdAt');

  const rows = logs.map((l) => ({
    timestamp: l.createdAt.toISOString(),
    actor: l.actor ? `${l.actor.firstName} ${l.actor.lastName}` : 'System',
    email: l.actor?.email || '',
    role: l.actorRole || '',
    action: l.action,
    description: l.description,
    ipAddress: l.ipAddress,
  }));

  const fields = ['timestamp', 'actor', 'email', 'role', 'action', 'description', 'ipAddress'];
  const parser = new Parser({ fields });
  const csv = parser.parse(rows);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=audit-logs-${new Date().toISOString().split('T')[0]}.csv`);
  res.status(200).send(csv);
});
