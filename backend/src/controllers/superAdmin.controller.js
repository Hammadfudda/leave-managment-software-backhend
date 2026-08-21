import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import SuperAdmin from '../models/SuperAdmin.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';

import {
  sendEmail,
  templates,
} from '../services/email.service.js';

import { asyncHandler } from '../utils/asyncHandler.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../utils/errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function makeSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function publicSuperAdmin(admin) {
  return {
    id: String(admin._id),
    fullName: admin.fullName,
    email: admin.email,
  };
}

function publicOrganization(organization) {
  const admin = organization.adminUserId;

  return {
    id: String(organization._id),
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
    admin:
      admin && typeof admin === 'object'
        ? {
            id: String(admin._id),
            fullName: admin.fullName,
            email: admin.email,
            status: admin.status,
          }
        : null,
  };
}


/*
|--------------------------------------------------------------------------
| ONE-TIME SUPER ADMIN SETUP
|--------------------------------------------------------------------------
|
| Create the very first Super Admin from Postman.
| Once one SuperAdmin exists, this endpoint permanently refuses setup.
|
*/
export const setupFirstSuperAdmin = asyncHandler(async (req, res) => {
  const fullName = clean(req.body.fullName) || 'SaaS Owner';
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password) {
    throw new ValidationError('Email and password are required.');
  }

  if (!EMAIL_RE.test(email)) {
    throw new ValidationError('Email is invalid.');
  }

  if (password.length < 10) {
    throw new ValidationError(
      'Password must be at least 10 characters.'
    );
  }

  const existingCount = await SuperAdmin.countDocuments();

  if (existingCount > 0) {
    return res.status(403).json({
      success: false,
      message:
        'Super Admin setup is already completed. Use the Super Admin login endpoint.',
    });
  }

  const superAdmin = await SuperAdmin.create({
    fullName,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    status: 'active',
  });

  return res.status(201).json({
    success: true,
    message: 'First Super Admin created successfully.',
    user: publicSuperAdmin(superAdmin),
  });
});

export const login = asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  if (!email || !password) {
    throw new ValidationError('Email and password are required.');
  }

  const superAdmin = await SuperAdmin.findOne({
    email,
    status: 'active',
  });

  const invalid = () =>
    res.status(401).json({
      success: false,
      message: 'Invalid credentials.',
    });

  if (!superAdmin) return invalid();

  const matches = await bcrypt.compare(password, superAdmin.passwordHash);

  if (!matches) return invalid();

  superAdmin.lastLoginAt = new Date();
  await superAdmin.save();

  const accessToken = jwt.sign(
    {
      id: String(superAdmin._id),
      kind: 'super_admin',
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '8h' }
  );

  return res.json({
    success: true,
    accessToken,
    user: publicSuperAdmin(superAdmin),
  });
});

export const me = asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    user: publicSuperAdmin(req.currentSuperAdmin),
  });
});

export const listOrganizations = asyncHandler(async (_req, res) => {
  const organizations = await Organization.find({})
    .populate('adminUserId', 'fullName email status')
    .sort({ createdAt: -1 });

  return res.json({
    success: true,
    data: organizations.map(publicOrganization),
  });
});

export const createOrganization = asyncHandler(async (req, res) => {
  const companyName = clean(req.body.companyName);
  const adminName = clean(req.body.adminName);
  const adminEmail = normalizeEmail(req.body.adminEmail);
  const password = String(req.body.password || '');

  if (!companyName || !adminName || !adminEmail || !password) {
    throw new ValidationError(
      'Company name, Admin name, Admin email and password are required.'
    );
  }

  if (!EMAIL_RE.test(adminEmail)) {
    throw new ValidationError('Admin email is invalid.');
  }

  if (password.length < 8) {
    throw new ValidationError(
      'Admin password must be at least 8 characters.'
    );
  }

  if (await User.exists({ email: adminEmail })) {
    throw new ConflictError(
      'A user with this Admin email already exists.'
    );
  }

  const baseSlug = makeSlug(companyName) || 'client';
  let slug = baseSlug;
  let counter = 2;

  while (await Organization.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const organization = await Organization.create({
    name: companyName,
    slug,
    status: 'active',
    createdBySuperAdminId: req.currentSuperAdmin._id,
  });

  try {
    const shortId = String(organization._id).slice(-8);

    const user = await User.create({
      fullName: adminName,
      email: adminEmail,
      nationalId: `SAAS-ADMIN-${shortId}`,
      passwordHash: await bcrypt.hash(password, 12),
      passwordChangedFromDefault: true,
      role: 'admin',
      organizationId: organization._id,
      employeeId: `ADMIN-${shortId.toUpperCase()}`,
      cnic: '',
      designation: 'Administrator',
      department: 'Administration',
      gradeId: null,
      managerId: null,
      canApproveOtherDepartments: true,
      dateOfJoining: new Date(),
      detailsStatus: 'complete',
      pendingFields: [],
      status: 'active',
    });

    organization.adminUserId = user._id;
    await organization.save();

    const populated = await Organization.findById(
      organization._id
    ).populate('adminUserId', 'fullName email status');

    const emailSent = await sendEmail({
      to: adminEmail,
      subject: 'Your Leave Management Admin account is ready',
      html: templates.clientAdminCreated({
        adminName,
        companyName,
        email: adminEmail,
        password,
      }),
    });

    return res.status(201).json({
      success: true,
      data: publicOrganization(populated),
      credentials: {
        email: adminEmail,
        password,
        emailSent,
      },
      emailSent,
    });
  } catch (error) {
    await Organization.findByIdAndDelete(organization._id);
    throw error;
  }
});

export const updateOrganizationStatus = asyncHandler(async (req, res) => {
  const status = clean(req.body.status).toLowerCase();

  if (!['active', 'suspended'].includes(status)) {
    throw new ValidationError('Status must be active or suspended.');
  }

  const organization = await Organization.findById(req.params.id);

  if (!organization) {
    throw new NotFoundError('Organization not found.');
  }

  organization.status = status;
  await organization.save();

  // Revoke active refresh sessions for every member of this organization.
  // Individual user active/inactive status is not overwritten.
  await User.updateMany(
    { organizationId: organization._id },
    { $set: { refreshTokenHash: null } }
  );

  const populated = await Organization.findById(
    organization._id
  ).populate('adminUserId', 'fullName email status');

  return res.json({
    success: true,
    data: publicOrganization(populated),
  });
});

export const resetClientAdminPassword = asyncHandler(async (req, res) => {
  const password = String(req.body.password || '');

  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters.');
  }

  const organization = await Organization.findById(req.params.id);

  if (!organization || !organization.adminUserId) {
    throw new NotFoundError('Client Admin was not found.');
  }

  const admin = await User.findById(organization.adminUserId);

  if (!admin) {
    throw new NotFoundError('Client Admin was not found.');
  }

  admin.passwordHash = await bcrypt.hash(password, 12);
  admin.passwordChangedFromDefault = true;
  admin.refreshTokenHash = null;
  admin.failedLoginAttempts = 0;
  admin.lockedUntil = null;

  await admin.save();

  return res.json({
    success: true,
    message: 'Client Admin password updated.',
    credentials: {
      email: admin.email,
      password,
    },
  });
});
