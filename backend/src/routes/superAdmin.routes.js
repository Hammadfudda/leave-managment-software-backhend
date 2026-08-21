import { Router } from 'express';

import * as superAdmin from '../controllers/superAdmin.controller.js';

import {
  authenticateSuperAdmin,
  loadSuperAdmin,
} from '../middleware/superAdminAuth.js';

import {
  loginLimiter,
} from '../middleware/rateLimit.js';

const router = Router();

router.post(
  '/login',
  loginLimiter,
  superAdmin.login
);

router.use(
  authenticateSuperAdmin,
  loadSuperAdmin
);

router.get(
  '/me',
  superAdmin.me
);

router.get(
  '/organizations',
  superAdmin.listOrganizations
);

router.post(
  '/organizations',
  superAdmin.createOrganization
);

router.patch(
  '/organizations/:id/status',
  superAdmin.updateOrganizationStatus
);

router.patch(
  '/organizations/:id/reset-admin-password',
  superAdmin.resetClientAdminPassword
);

export default router;
