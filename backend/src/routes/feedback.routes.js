import { Router } from 'express';
import {
  authenticate,
  authorize,
  loadUser,
} from '../middleware/auth.js';
import * as feedback from '../controllers/feedback.controller.js';

const router = Router();

router.use(
  authenticate,
  loadUser,
  authorize('admin')
);

router.get('/', feedback.listMyFeedback);
router.post('/', feedback.createFeedback);

export default router;
