const Notification = require('../models/Notification');
const { sendLeaveSubmittedEmail, sendLeaveStatusEmail } = require('./emailService');

async function createNotification({
  recipient,
  type,
  title,
  message,
  relatedLeave = null,
  channel = 'in_app',
  recipientEmail = null,
  recipientName = null,
  leaveDetails = null,
  comment = null,
}) {
  try {
    await Notification.create({
      recipient,
      type,
      title,
      message,
      relatedLeave,
      channel,
    });

    if ((channel === 'email' || channel === 'both') && recipientEmail) {
      if (type === 'leave_request_submitted' && leaveDetails) {
        await sendLeaveSubmittedEmail(recipientEmail, recipientName || 'Approver', leaveDetails);
      } else if ((type === 'leave_approved' || type === 'leave_rejected') && leaveDetails) {
        await sendLeaveStatusEmail(recipientEmail, recipientName || 'Employee', type.split('_')[1], leaveDetails, comment);
      }
    }
  } catch (err) {
    console.error('Notification creation failed:', err.message);
  }
}

module.exports = { createNotification };
