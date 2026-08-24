import bcrypt from 'bcryptjs';

import Organization from '../models/Organization.js';
import User from '../models/User.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

import {
  generateTemporaryPassword,
  sendTemporaryAccountEmail,
} from '../services/temporaryPassword.service.js';

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

function makeSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function publicOrganization(
  organization
) {
  const admin =
    organization.adminUserId;

  return {
    id:
      String(
        organization._id
      ),
    name:
      organization.name,
    slug:
      organization.slug,
    status:
      organization.status,
    createdAt:
      organization.createdAt,
    updatedAt:
      organization.updatedAt,
    admin:
      admin &&
      typeof admin ===
        'object'
        ? {
            id:
              String(
                admin._id
              ),
            fullName:
              admin.fullName,
            email:
              admin.email,
            status:
              admin.status,
          }
        : null,
  };
}

export const createOrganizationWithTemporaryPassword =
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
          'Company name, Admin name and Admin email are required.'
        );
      }

      if (
        !EMAIL_RE.test(
          adminEmail
        )
      ) {
        throw new ValidationError(
          'Admin email is invalid.'
        );
      }

      if (
        await User.exists({
          email:
            adminEmail,
        })
      ) {
        throw new ConflictError(
          'A user with this Admin email already exists.'
        );
      }

      const baseSlug =
        makeSlug(
          companyName
        ) || 'client';

      let slug = baseSlug;
      let counter = 2;

      while (
        await Organization.exists({
          slug,
        })
      ) {
        slug =
          `${baseSlug}-${counter}`;
        counter += 1;
      }

      const organization =
        await Organization.create({
          name:
            companyName,
          slug,
          status:
            'active',
          createdBySuperAdminId:
            req.currentSuperAdmin._id,
        });

      const temporaryPassword =
        generateTemporaryPassword();

      try {
        const shortId =
          String(
            organization._id
          ).slice(-8);

        const user =
          await User.create({
            fullName:
              adminName,
            email:
              adminEmail,
            nationalId:
              `SAAS-ADMIN-${shortId}`,
            passwordHash:
              await bcrypt.hash(
                temporaryPassword,
                12
              ),
            passwordChangedFromDefault:
              false,
            mustChangePassword:
              true,
            role:
              'admin',
            organizationId:
              organization._id,
            employeeId:
              `ADMIN-${shortId.toUpperCase()}`,
            cnic:
              '',
            designation:
              'Administrator',
            department:
              'Administration',
            gradeId:
              null,
            managerId:
              null,
            canApproveOtherDepartments:
              true,
            dateOfJoining:
              new Date(),
            detailsStatus:
              'complete',
            pendingFields:
              [],
            status:
              'active',
          });

        organization.adminUserId =
          user._id;

        await organization.save();

        const populated =
          await Organization.findById(
            organization._id
          ).populate(
            'adminUserId',
            'fullName email status'
          );

        const emailSent =
          await sendTemporaryAccountEmail({
            to:
              adminEmail,
            fullName:
              adminName,
            roleLabel:
              'Client Admin',
            companyName,
            temporaryPassword,
          });

        if (!emailSent) {
          await User.deleteOne({
            _id:
              user._id,
          });

          await Organization.findByIdAndDelete(
            organization._id
          );

          throw new ValidationError(
            'Client Admin email could not be sent, so the new client account was not kept. Please check SMTP and try again.'
          );
        }

        return res
          .status(201)
          .json({
            success: true,
            data:
              publicOrganization(
                populated
              ),
            credentials: {
              email:
                adminEmail,
              password:
                temporaryPassword,
              temporaryPassword:
                true,
              emailSent,
            },
            emailSent,
          });
      } catch (error) {
        await Organization.findByIdAndDelete(
          organization._id
        );

        throw error;
      }
    }
  );

export const resetClientAdminToTemporaryPassword =
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
        !organization ||
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

      const temporaryPassword =
        generateTemporaryPassword();

      const previousPasswordHash =
        admin.passwordHash;

      const previousPasswordChangedFromDefault =
        admin.passwordChangedFromDefault;

      const previousMustChangePassword =
        admin.mustChangePassword;

      const previousRefreshTokenHash =
        admin.refreshTokenHash;

      admin.passwordHash =
        await bcrypt.hash(
          temporaryPassword,
          12
        );

      admin.passwordChangedFromDefault =
        false;

      admin.mustChangePassword =
        true;

      admin.refreshTokenHash =
        null;

      admin.failedLoginAttempts =
        0;

      admin.lockedUntil =
        null;

      await admin.save();

      const emailSent =
        await sendTemporaryAccountEmail({
          to:
            admin.email,
          fullName:
            admin.fullName,
          roleLabel:
            'Client Admin',
          companyName:
            organization.name,
          temporaryPassword,
        });

      if (!emailSent) {
        admin.passwordHash =
          previousPasswordHash;

        admin.passwordChangedFromDefault =
          previousPasswordChangedFromDefault;

        admin.mustChangePassword =
          previousMustChangePassword;

        admin.refreshTokenHash =
          previousRefreshTokenHash;

        await admin.save();

        throw new ValidationError(
          'Temporary password email could not be sent. The Client Admin password was left unchanged.'
        );
      }

      return res.json({
        success: true,
        message:
          'A new temporary password was generated. Client Admin must change it after login.',
        credentials: {
          email:
            admin.email,
          password:
            temporaryPassword,
          temporaryPassword:
            true,
          emailSent,
        },
        emailSent,
      });
    }
  );
