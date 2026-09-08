const Notification = require('../models/Notification');
const { NotFoundError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');

exports.getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const filter = { recipient: req.employee._id };
  if (unreadOnly === 'true') filter.isRead = false;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort('-createdAt').skip(skip).limit(parseInt(limit)),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.employee._id, isRead: false }),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      notifications,
      unreadCount,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    },
  });
});

exports.markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.employee._id },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
  if (!notification) throw new NotFoundError('Notification');
  res.status(200).json({ status: 'success', message: 'Notification marked as read.', data: { notification } });
});

exports.markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { recipient: req.employee._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.status(200).json({ status: 'success', message: 'All notifications marked as read.' });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.employee._id });
  if (!notification) throw new NotFoundError('Notification');
  res.status(200).json({ status: 'success', message: 'Notification deleted.' });
});

exports.getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.employee._id, isRead: false });
  res.status(200).json({ status: 'success', data: { count } });
});
