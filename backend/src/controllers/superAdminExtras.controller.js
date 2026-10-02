import Organization from '../models/Organization.js';
import User from '../models/User.js';
import FeedbackRequest from '../models/FeedbackRequest.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { layout, sendEmail } from '../services/email.service.js';
import { RESTORE_WINDOW_DAYS, purgeOrganizationData } from '../services/deletion.service.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => String(v ?? '').trim();
const normalizeEmail = (v) => clean(v).toLowerCase();
const esc = (v) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const pub = (f) => ({
  id: String(f._id),
  organizationId: f.organizationId ? String(f.organizationId) : null,
  organizationName: f.organizationName || '',
  submittedByName: f.submittedByName,
  submittedByEmail: f.submittedByEmail,
  type: f.type,
  subject: f.subject,
  message: f.message,
  status: f.status,
  superAdminNote: f.superAdminNote || '',
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  resolvedAt: f.resolvedAt,
});

export const updateOrganizationDetails = asyncHandler(async (req, res) => {
  const companyName = clean(req.body.companyName);
  const adminName = clean(req.body.adminName);
  const adminEmail = normalizeEmail(req.body.adminEmail);

  if (!companyName || !adminName || !adminEmail) {
    throw new ValidationError(
      'Company name, Client Admin name and Client Admin email are required.'
    );
  }

  if (!EMAIL_RE.test(adminEmail)) {
    throw new ValidationError('Client Admin email is invalid.');
  }

  const o = await Organization.findById(req.params.id);
  if (!o) throw new NotFoundError('Organization not found.');
  if (!o.adminUserId) throw new NotFoundError('Client Admin was not found.');

  const a = await User.findById(o.adminUserId);
  if (!a) throw new NotFoundError('Client Admin was not found.');

  if (await User.exists({ email: adminEmail, _id: { $ne: a._id } })) {
    throw new ConflictError('Another user already uses this email address.');
  }

  const changed = a.email !== adminEmail;
  o.name = companyName;
  a.fullName = adminName;
  a.email = adminEmail;

  if (changed) a.refreshTokenHash = null;

  await a.save();
  await o.save();

  const p = await Organization.findById(o._id).populate(
    'adminUserId',
    'fullName email status'
  );

  return res.json({
    success: true,
    message: 'Client organization updated successfully.',
    data: {
      id: String(p._id),
      name: p.name,
      slug: p.slug,
      status: p.status,
      createdAt: p.createdAt,
      admin: p.adminUserId
        ? {
            id: String(p.adminUserId._id),
            fullName: p.adminUserId.fullName,
            email: p.adminUserId.email,
            status: p.adminUserId.status,
          }
        : null,
    },
  });
});

export const listFeedbackRequests = asyncHandler(async (_req, res) =>
  res.json({
    success: true,
    data: (await FeedbackRequest.find({}).sort({ createdAt: -1 }).limit(500)).map(pub),
  })
);

export const updateFeedbackRequest = asyncHandler(async (req, res) => {
  const status = clean(req.body.status);
  const note = clean(req.body.superAdminNote);

  if (!['new', 'reviewing', 'resolved'].includes(status)) {
    throw new ValidationError('Status must be new, reviewing or resolved.');
  }

  const f = await FeedbackRequest.findById(req.params.id);
  if (!f) throw new NotFoundError('Feedback request not found.');

  f.status = status;
  f.superAdminNote = note;
  f.resolvedAt = status === 'resolved' ? new Date() : null;

  await f.save();

  let emailSent = false;

  if (f.submittedByEmail) {
    const pretty =
      status === 'resolved'
        ? 'Resolved'
        : status === 'reviewing'
          ? 'Reviewing'
          : 'New';

    emailSent = await sendEmail({
      to: f.submittedByEmail,
      subject: `Update on your support request — ${f.subject}`,
      html: layout(
        'Support Request Update',
        `
          <p>
            Hi ${esc(f.submittedByName || 'Client Admin')},
          </p>

          <p>
            Your request
            <strong>${esc(f.subject)}</strong>
            has been updated.
          </p>

          <p>
            <strong>Status:</strong>
            ${esc(pretty)}
          </p>

          ${
            note
              ? `
                <p>
                  <strong>Reply from Nedd Consultant:</strong>
                </p>

                <div
                  style="
                    white-space:pre-wrap;
                    padding:12px 14px;
                    background:#f8fafc;
                    border:1px solid #e2e8f0;
                    border-radius:8px;
                  "
                >
                  ${esc(note)}
                </div>
              `
              : `
                <p>
                  Your request status has been updated to
                  <strong>${esc(pretty)}</strong>.
                </p>
              `
          }

          <p>
            Regards,
            <br/>
            Nedd Consultant
          </p>
        `
      ),
    });
  }

  return res.json({
    success: true,
    emailSent,
    message: emailSent
      ? 'Feedback updated and reply email sent successfully.'
      : 'Feedback updated successfully. Reply email could not be sent.',
    data: pub(f),
  });
});

export const broadcastAdminUpdate = asyncHandler(async (req, res) => {
  const subject = clean(req.body.subject);
  const message = clean(req.body.message);

  if (!subject) {
    throw new ValidationError('Subject is required.');
  }

  if (!message) {
    throw new ValidationError('Message is required.');
  }

  const orgIds = (
    await Organization.find({
      status: 'active',
    })
      .select('_id')
      .lean()
  ).map((x) => x._id);

  const admins = await User.find({
    role: 'admin',
    status: 'active',
    organizationId: {
      $in: orgIds,
    },
  })
    .select('fullName email')
    .lean();

  let sent = 0;
  let failed = 0;

  for (const a of admins) {
    const ok = await sendEmail({
      to: a.email,
      subject,
      html: layout(
        esc(subject),
        `
          <p>
            Hi ${esc(a.fullName)},
          </p>

          <p>
            We have an update for the Leave Management Software.
          </p>

          <div
            style="
              white-space:pre-wrap;
              padding:12px 14px;
              background:#f8fafc;
              border:1px solid #e2e8f0;
              border-radius:8px;
            "
          >
            ${esc(message)}
          </div>

          <p>
            Regards,
            <br/>
            Nedd Consultant
          </p>
        `
      ),
    });

    if (ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return res.json({
    success: true,
    message: `Update sent to ${sent} Client Admin(s).`,
    data: {
      total: admins.length,
      sent,
      failed,
    },
  });
});

export const deleteClientOrganization = asyncHandler(async (req, res) => {
  const o = await Organization.findById(req.params.id);
  if (!o) throw new NotFoundError('Organization not found.');
  if (o.status === 'pending_deletion') throw new ValidationError('This client is already in Recently Deleted.');
  const now = new Date();
  o.status = 'pending_deletion';
  o.deactivatedAt = now;
  o.scheduledPurgeAt = new Date(now.getTime() + RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  o.deletedBy = req.currentSuperAdmin._id;
  await o.save();
  await User.updateMany({ organizationId: o._id }, { $set: { refreshTokenHash: null } });
  return res.json({
    success: true,
    message: `Client "${o.name}" moved to Recently Deleted. All access was revoked. It will be permanently deleted after ${RESTORE_WINDOW_DAYS} days unless restored.`,
    data: { organizationId: String(o._id), organizationName: o.name, scheduledPurgeAt: o.scheduledPurgeAt },
  });
});

export const restoreClientOrganization = asyncHandler(async (req, res) => {
  const o = await Organization.findById(req.params.id);
  if (!o) throw new NotFoundError('Organization not found.');
  if (o.status !== 'pending_deletion') throw new ValidationError('This client is not in Recently Deleted.');
  if (o.scheduledPurgeAt && o.scheduledPurgeAt.getTime() <= Date.now()) throw new ValidationError('The 10-day restore window has expired. This client is awaiting permanent deletion.');
  o.status = 'active';
  o.deactivatedAt = null;
  o.scheduledPurgeAt = null;
  o.deletedBy = null;
  await o.save();
  return res.json({
    success: true,
    message: `Client "${o.name}" restored successfully. Client users must sign in again because previous sessions were revoked.`,
    data: { organizationId: String(o._id), organizationName: o.name, status: o.status },
  });
});

export const purgeClientOrganizationNow = asyncHandler(async (req, res) => {
  const o = await Organization.findById(req.params.id);
  if (!o) throw new NotFoundError('Organization not found.');
  if (o.status !== 'pending_deletion') throw new ValidationError('Only clients in Recently Deleted can be permanently deleted.');
  if (o.scheduledPurgeAt && o.scheduledPurgeAt.getTime() > Date.now()) throw new ValidationError('Permanent deletion is locked until the 10-day restore window expires.');
  const result = await purgeOrganizationData(o._id);
  return res.json({ success: true, message: `Client "${result.organizationName}" and all tenant data were permanently deleted.`, data: result });
});
