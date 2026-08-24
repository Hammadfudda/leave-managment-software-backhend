import { Router } from 'express';

import * as superAdmin from '../controllers/superAdmin.controller.js';
import * as extras from '../controllers/superAdminExtras.controller.js';

import * as clientAccount from '../controllers/clientAccount.controller.js';

import {
  authenticateSuperAdmin,
  loadSuperAdmin,
} from '../middleware/superAdminAuth.js';

import {
  loginLimiter,
} from '../middleware/rateLimit.js';

const router = Router();

router.post(
  '/setup',
  loginLimiter,
  superAdmin.setupFirstSuperAdmin
);

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
  clientAccount.createOrganizationWithTemporaryPassword
);

router.patch(
  '/organizations/:id/status',
  superAdmin.updateOrganizationStatus
);

router.patch(
  '/organizations/:id/reset-admin-password',
  clientAccount.resetClientAdminToTemporaryPassword
);

router.patch(
  '/organizations/:id',
  extras.updateOrganizationDetails
);

router.delete(
  '/organizations/:id',
  extras.deleteClientOrganization
);

router.get(
  '/feedback',
  extras.listFeedbackRequests
);

router.patch(
  '/feedback/:id',
  extras.updateFeedbackRequest
);

router.post(
  '/broadcast',
  extras.broadcastAdminUpdate
);

export default router;
