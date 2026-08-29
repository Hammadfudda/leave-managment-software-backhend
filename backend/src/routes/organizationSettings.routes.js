import { Router } from 'express';
import {
  getOrganizationSettings,
  updateOrganizationSettings,
} from '../controllers/organizationSettings.controller.js';
import {
  authenticate,
  authorize,
  loadUser,
} from '../middleware/auth.js';

const router = Router();

router.use(authenticate, loadUser);

router.get('/', getOrganizationSettings);

router.patch(
  '/',
  authorize('admin'),
  updateOrganizationSettings
);

export default router;
