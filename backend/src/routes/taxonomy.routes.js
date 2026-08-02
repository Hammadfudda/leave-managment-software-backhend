import { Router } from 'express';
import { grades, departments, designations, roles } from '../controllers/taxonomy.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';

/**
 * The four lookup lists share one router factory. Everyone signed in can READ
 * them (the forms need them); only Admin can mutate them.
 */
function taxonomyRouter(controller) {
  const router = Router();
  router.use(authenticate, loadUser);

  router.get('/', controller.list);
  router.post('/', authorize('admin'), controller.create);
  router.patch('/:id', authorize('admin'), controller.update);
  router.delete('/:id', authorize('admin'), controller.remove);

  return router;
}

export const gradeRoutes = taxonomyRouter(grades);
export const departmentRoutes = taxonomyRouter(departments);
export const designationRoutes = taxonomyRouter(designations);
export const roleRoutes = taxonomyRouter(roles);
