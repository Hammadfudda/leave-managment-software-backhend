import mongoose from 'mongoose';

import Organization from '../models/Organization.js';
import User from '../models/User.js';
import FeedbackRequest from '../models/FeedbackRequest.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  layout,
  sendEmail,
} from '../services/email.service.js';

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
  return String(
    value ?? ''
  ).trim();
}

function normalizeEmail(value) {
  return clean(
    value
  ).toLowerCase();
}

function escapeHtml(value) {
  return String(
    value ?? ''
  )
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function publicFeedback(item) {
  return {
    id:
      String(
        item._id
      ),

    organizationId:
      item.organizationId
        ? String(
            item.organizationId
          )
        : null,

    organizationName:
      item.organizationName ||
      '',

    submittedByName:
      item.submittedByName,

    submittedByEmail:
      item.submittedByEmail,

    type:
      item.type,

    subject:
      item.subject,

    message:
      item.message,

    status:
      item.status,

    superAdminNote:
      item.superAdminNote ||
      '',

    createdAt:
      item.createdAt,

    updatedAt:
      item.updatedAt,

    resolvedAt:
      item.resolvedAt,
  };
}

export const updateOrganizationDetails =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const companyName =
        clean(
          req.body.companyName
        );

      const adminName =
        clean(
          req.body.adminName
        );

      const adminEmail =
        normalizeEmail(
          req.body.adminEmail
        );

      if (
        !companyName ||
        !adminName ||
        !adminEmail
      ) {
        throw new ValidationError(
          'Company name, Client Admin name and Client Admin email are required.'
        );
      }

      if (
        !EMAIL_RE.test(
          adminEmail
        )
      ) {
        throw new ValidationError(
          'Client Admin email is invalid.'
        );
      }

      const organization =
        await Organization.findById(
          req.params.id
        );

      if (
        !organization
      ) {
        throw new NotFoundError(
          'Organization not found.'
        );
      }

      if (
        !organization.adminUserId
      ) {
        throw new NotFoundError(
          'Client Admin was not found.'
        );
      }

      const admin =
        await User.findById(
          organization.adminUserId
        );

      if (!admin) {
        throw new NotFoundError(
          'Client Admin was not found.'
        );
      }

      const duplicate =
        await User.exists({
          email:
            adminEmail,

          _id: {
            $ne:
              admin._id,
          },
        });

      if (duplicate) {
        throw new ConflictError(
          'Another user already uses this email address.'
        );
      }

      const emailChanged =
        admin.email !==
        adminEmail;

      organization.name =
        companyName;

      admin.fullName =
        adminName;

      admin.email =
        adminEmail;

      if (
        emailChanged
      ) {
        admin.refreshTokenHash =
          null;
      }

      await admin.save();
      await organization.save();

      const populated =
        await Organization.findById(
          organization._id
        ).populate(
          'adminUserId',
          'fullName email status'
        );

      return res.json({
        success: true,

        message:
          'Client organization updated successfully.',

        data: {
          id:
            String(
              populated._id
            ),

          name:
            populated.name,

          slug:
            populated.slug,

          status:
            populated.status,

          createdAt:
            populated.createdAt,

          admin:
            populated.adminUserId
              ? {
                  id:
                    String(
                      populated.adminUserId._id
                    ),

                  fullName:
                    populated.adminUserId.fullName,

                  email:
                    populated.adminUserId.email,

                  status:
                    populated.adminUserId.status,
                }
              : null,
        },
      });
    }
  );

export const listFeedbackRequests =
  asyncHandler(
    async (
      _req,
      res
    ) => {
      const rows =
        await FeedbackRequest.find({})
          .sort({
            createdAt:
              -1,
          })
          .limit(500);

      return res.json({
        success: true,

        data:
          rows.map(
            publicFeedback
          ),
      });
    }
  );

export const updateFeedbackRequest =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const status =
        clean(
          req.body.status
        );

      const superAdminNote =
        clean(
          req.body.superAdminNote
        );

      if (
        ![
          'new',
          'reviewing',
          'resolved',
        ].includes(
          status
        )
      ) {
        throw new ValidationError(
          'Status must be new, reviewing or resolved.'
        );
      }

      const feedback =
        await FeedbackRequest.findById(
          req.params.id
        );

      if (!feedback) {
        throw new NotFoundError(
          'Feedback request not found.'
        );
      }

      feedback.status =
        status;

      feedback.superAdminNote =
        superAdminNote;

      feedback.resolvedAt =
        status ===
        'resolved'
          ? new Date()
          : null;

      await feedback.save();

      /*
       * The feedback update itself is already safely stored at this point.
       * Email delivery must NEVER roll back the saved status/note.
       */
      let emailSent =
        false;

      if (
        feedback.submittedByEmail
      ) {
        const prettyStatus =
          status ===
          'resolved'
            ? 'Resolved'
            : status ===
                'reviewing'
              ? 'Reviewing'
              : 'New';

        const replySection =
          superAdminNote
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
                  ${escapeHtml(superAdminNote)}
                </div>
              `
            : `
                <p>
                  Your request status has been updated to
                  <strong>${escapeHtml(prettyStatus)}</strong>.
                </p>
              `;

        emailSent =
          await sendEmail({
            to:
              feedback.submittedByEmail,

            subject:
              `Update on your support request — ${feedback.subject}`,

            html:
              layout(
                'Support Request Update',
                `
                  <p>
                    Hi ${escapeHtml(
                      feedback.submittedByName ||
                        'Client Admin'
                    )},
                  </p>

                  <p>
                    Your request
                    <strong>${escapeHtml(feedback.subject)}</strong>
                    has been updated.
                  </p>

                  <p>
                    <strong>Status:</strong>
                    ${escapeHtml(prettyStatus)}
                  </p>

                  ${replySection}

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

        message:
          emailSent
            ? 'Feedback updated and reply email sent successfully.'
            : 'Feedback updated successfully. Reply email could not be sent.',

        data:
          publicFeedback(
            feedback
          ),
      });
    }
  );

export const broadcastAdminUpdate =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const subject =
        clean(
          req.body.subject
        );

      const message =
        clean(
          req.body.message
        );

      if (!subject) {
        throw new ValidationError(
          'Subject is required.'
        );
      }

      if (!message) {
        throw new ValidationError(
          'Message is required.'
        );
      }

      const activeOrganizations =
        await Organization.find({
          status:
            'active',
        })
          .select('_id')
          .lean();

      const organizationIds =
        activeOrganizations.map(
          (item) =>
            item._id
        );

      const admins =
        await User.find({
          role:
            'admin',

          status:
            'active',

          organizationId: {
            $in:
              organizationIds,
          },
        })
          .select(
            'fullName email'
          )
          .lean();

      let sent = 0;
      let failed = 0;

      for (
        const admin of
        admins
      ) {
        const ok =
          await sendEmail({
            to:
              admin.email,

            subject,

            html:
              layout(
                escapeHtml(
                  subject
                ),
                `
                  <p>
                    Hi ${escapeHtml(admin.fullName)},
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
                    ${escapeHtml(message)}
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

        message:
          `Update sent to ${sent} Client Admin(s).`,

        data: {
          total:
            admins.length,

          sent,

          failed,
        },
      });
    }
  );


/*
|--------------------------------------------------------------------------
| DELETE CLIENT ORGANIZATION
|--------------------------------------------------------------------------
|
| Permanent SaaS-owner action.
|
| Deletes every database record that belongs to the selected organization by
| organizationId, including the Client Admin, Managers, Employees, policies,
| balances, leave requests, notifications, audit logs, feedback and master data.
|
| The Organization document itself is deleted LAST. If an earlier cleanup step
| fails, the organization record remains so the operation can be retried safely.
|
| SuperAdmin and other organizations are never matched by this query.
|
*/
export const deleteClientOrganization =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const organization =
        await Organization.findById(
          req.params.id
        );

      if (
        !organization
      ) {
        throw new NotFoundError(
          'Organization not found.'
        );
      }

      const organizationId =
        organization._id;

      const usersBeforeDelete =
        await User.countDocuments({
          organizationId,
        });

      /*
       * Raw collection deletes are intentional here.
       *
       * Super Admin routes do not run inside a tenant context, and iterating
       * MongoDB collections ensures all present/future tenant-owned collections
       * using organizationId are cleaned without missing a model import.
       *
       * Exclusions:
       * - organizations: deleted explicitly at the end
       * - superadmins: global SaaS owner accounts, never tenant-owned
       */
      const excludedCollections =
        new Set([
          'organizations',
          'superadmins',
        ]);

      let deletedTenantRecords =
        0;

      const database =
        mongoose.connection.db;

      if (
        !database
      ) {
        throw new ValidationError(
          'Database connection is not ready.'
        );
      }

      const collections =
        await database
          .listCollections(
            {},
            {
              nameOnly:
                true,
            }
          )
          .toArray();

      for (
        const item of
        collections
      ) {
        const collectionName =
          item.name;

        if (
          excludedCollections.has(
            collectionName
          ) ||
          collectionName.startsWith(
            'system.'
          )
        ) {
          continue;
        }

        const result =
          await database
            .collection(
              collectionName
            )
            .deleteMany({
              organizationId,
            });

        deletedTenantRecords +=
          result.deletedCount ||
          0;
      }

      await Organization.deleteOne({
        _id:
          organizationId,
      });

      return res.json({
        success:
          true,

        message:
          `Client "${organization.name}" permanently deleted. ${usersBeforeDelete} user account(s) and ${deletedTenantRecords} tenant record(s) were removed.`,

        data: {
          organizationId:
            String(
              organizationId
            ),

          organizationName:
            organization.name,

          deletedUsers:
            usersBeforeDelete,

          deletedTenantRecords,
        },
      });
    }
  );
