import { Router } from 'express';
import * as policies from '../controllers/policy.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, loadUser);

router.get('/eligible-approvers', authorize('admin'), policies.listEligibleApprovers);
router.get('/', authorize('admin', 'manager'), policies.listPolicies);
router.post('/', authorize('admin'), policies.createPolicy);
router.patch('/:id', authorize('admin'), policies.updatePolicy);

export default router;
