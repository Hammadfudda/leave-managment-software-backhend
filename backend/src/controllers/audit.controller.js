import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPagination, paginated } from '../utils/pagination.js';

/** Spec Part 8.3 — Admin only. Audit logs are append-only; there is no edit or
 * delete endpoint anywhere in this API, by design. */
export const listAuditLogs = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.actorId) filter.actorId = req.query.actorId;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.targetType) filter.targetType = req.query.targetType;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  const pagination = getPagination(req.query);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    AuditLog.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(items, total, pagination) });
});
