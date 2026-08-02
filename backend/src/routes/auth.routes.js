import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { loginLimiter, forgotPasswordLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/login', loginLimiter, auth.login);
router.post('/logout', auth.logout);
router.post('/refresh', auth.refresh);
router.post('/forgot-password', forgotPasswordLimiter, auth.forgotPassword);
router.post('/reset-password', auth.resetPassword);

export default router;
