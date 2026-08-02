import { Router } from 'express';
import * as team from '../controllers/team.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, loadUser);

router.get('/my-team', authorize('admin', 'manager'), team.myTeam);
router.get('/managers', authorize('admin', 'manager'), team.listManagers);

export default router;
