const AuditLog = require('../models/AuditLog');

async function logAudit({
  actor,
  actorRole,
  action,
  target,
  targetModel,
  description = '',
  metadata = {},
  req = null,
}) {
  try {
    await AuditLog.create({
      actor,
      actorRole,
      action,
      target,
      targetModel,
      description,
      metadata,
      ipAddress: req?.ip || '',
      userAgent: req?.get('User-Agent') || '',
    });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit };
