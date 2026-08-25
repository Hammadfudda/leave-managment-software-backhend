import {
  Router,
} from 'express';

import {
  deliverCredentialEmail,
} from '../controllers/qstash.controller.js';

const router =
  Router();

/*
 * Public by necessity: QStash calls this URL from outside Vercel.
 * Security comes from mandatory Upstash-Signature verification.
 */
router.post(
  '/credential-email',
  deliverCredentialEmail
);

export default router;
