import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ForbiddenError } from '../utils/errors.js';
import { sanitizeUser } from '../utils/tokens.js';
import { getLeaveBalancesForUser } from '../services/balance.service.js';

/**
 * Spec Part 11 — GET /api/team/my-team.
 * A manager always sees their own direct reports and cannot pass ?managerId to
 * look at somebody else's team; only Admin may do that.
 */
export const myTeam = asyncHandler(async (req, res) => {
  let managerId = req.currentUser._id;
  if (req.query.managerId) {
    if (req.currentUser.role !== 'admin') {
      throw new ForbiddenError('Only an administrator can view another manager\'s team.');
    }
    managerId = req.query.managerId;
  }

  const members = await User.find({ managerId, status: 'active' })
    .populate('gradeId', 'name')
    .sort({ fullName: 1 });

  const data = [];
  for (const member of members) {
    data.push({
      ...sanitizeUser(member),
      leaveBalances: await getLeaveBalancesForUser(member._id),
    });
  }

  res.json({ success: true, data });
});

/** Directory of managers, used by Admin's Managers view and approver pickers. */
export const listManagers = asyncHandler(async (req, res) => {
  const filter = { role: 'manager', status: 'active' };
  if (req.query.department) filter.department = req.query.department;

  const managers = await User.find(filter).sort({ fullName: 1 });

  const data = [];
  for (const manager of managers) {
    data.push({
      ...sanitizeUser(manager),
      directReportCount: await User.countDocuments({ managerId: manager._id, status: 'active' }),
    });
  }

  res.json({ success: true, data });
});
