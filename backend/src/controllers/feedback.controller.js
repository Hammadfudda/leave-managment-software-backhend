import Organization from '../models/Organization.js';
import FeedbackRequest from '../models/FeedbackRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ValidationError } from '../utils/errors.js';
import { layout, sendEmail } from '../services/email.service.js';

const OWNER_EMAIL =
  process.env.SUPER_ADMIN_FEEDBACK_EMAIL ||
  'hammadmemon561@gmail.com';

function clean(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toPublic(item) {
  return {
    id: String(item._id),
    type: item.type,
    subject: item.subject,
    message: item.message,
    status: item.status,
    organizationName: item.organizationName,
    submittedByName: item.submittedByName,
    submittedByEmail: item.submittedByEmail,
    superAdminNote: item.superAdminNote || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export const createFeedback = asyncHandler(async (req, res) => {
  const user = req.currentUser;
  const type = clean(req.body.type) || 'feedback';
  const subject = clean(req.body.subject);
  const message = clean(req.body.message);

  if (!['feedback', 'change_request', 'issue'].includes(type)) {
    throw new ValidationError('Invalid feedback type.');
  }

  if (!subject) throw new ValidationError('Subject is required.');
  if (!message) throw new ValidationError('Message is required.');

  let organizationName = '';

  if (user.organizationId) {
    const organization = await Organization.findById(
      user.organizationId
    )
      .select('name')
      .lean();

    organizationName = organization?.name || '';
  }

  const feedback = await FeedbackRequest.create({
    submittedById: user._id,
    submittedByName: user.fullName,
    submittedByEmail: user.email,
    organizationName,
    type,
    subject,
    message,
    status: 'new',
  });

  const emailSent = await sendEmail({
    to: OWNER_EMAIL,
    subject: `[Feedback] ${organizationName || 'Client'} — ${subject}`,
    html: layout(
      'New Client Feedback / Request',
      `
        <p><strong>Company:</strong> ${escapeHtml(organizationName || '—')}</p>
        <p><strong>Admin:</strong> ${escapeHtml(user.fullName)} (${escapeHtml(user.email)})</p>
        <p><strong>Type:</strong> ${escapeHtml(type.replaceAll('_', ' '))}</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
        <div style="white-space:pre-wrap;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">${escapeHtml(message)}</div>
        <p>Open the Super Admin panel to review this request.</p>
      `
    ),
  });

  return res.status(201).json({
    success: true,
    data: toPublic(feedback),
    emailSent,
  });
});

export const listMyFeedback = asyncHandler(async (_req, res) => {
  const rows = await FeedbackRequest.find({})
    .sort({ createdAt: -1 })
    .limit(100);

  return res.json({
    success: true,
    data: rows.map(toPublic),
  });
});
