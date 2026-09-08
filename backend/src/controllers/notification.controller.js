import Notification from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import { getPagination, paginated } from '../utils/pagination.js';

/** Spec Part 8.1 — a user only ever sees their own notifications. */
export const listNotifications = asyncHandler(async (req, res) => {
  const filter = { userId: req.currentUser._id };
  if (req.query.isRead !== undefined) filter.isRead = req.query.isRead === 'true';

  const pagination = getPagination(req.query);
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ userId: req.currentUser._id, isRead: false }),
  ]);

  res.json({ success: true, unreadCount, ...paginated(items, total, pagination) });
});

export const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    userId: req.currentUser._id,
  });
  if (!notification) throw new NotFoundError();

  notification.isRead = true;
  await notification.save();
  res.json({ success: true, data: notification });
});
