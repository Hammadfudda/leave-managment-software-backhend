import { Router } from 'express';
import * as notifications from '../controllers/notification.controller.js';
import { authenticate, loadUser } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, loadUser);

router.get('/', notifications.listNotifications);
router.patch('/:id/read', notifications.markRead);

export default router;
