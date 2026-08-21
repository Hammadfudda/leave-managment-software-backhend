import {
  Router,
} from 'express';

import * as notifications from '../controllers/notification.controller.js';

import {
  authenticate,
  loadUser,
} from '../middleware/auth.js';

const router =
  Router();

router.use(
  authenticate,
  loadUser
);

router.get(
  '/',
  notifications.listNotifications
);

/*
 * Keep this static route BEFORE /:id/read.
 */
router.patch(
  '/read-all',
  notifications.markAllRead
);

router.patch(
  '/:id/read',
  notifications.markRead
);

export default router;
