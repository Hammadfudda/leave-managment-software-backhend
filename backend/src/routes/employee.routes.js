import {
  Router,
} from 'express';

import * as employees from '../controllers/employee.controller.js';

import {
  createEmployeeWithTemporaryPassword,
} from '../controllers/accountCreation.controller.js';

import {
  completePendingEmployeeWithTemporaryPassword,
  importEmployeesCsvWithTemporaryPasswords,
} from '../controllers/csvImportTemporaryPassword.controller.js';

import {
  authenticate,
  authorize,
  loadUser,
} from '../middleware/auth.js';

import {
  uploadCsv,
} from '../middleware/upload.js';

import {
  validateEmployeeManager,
} from '../middleware/validateEmployeeManager.js';

const router =
  Router();

router.use(
  authenticate,
  loadUser
);

router.get(
  '/me',
  employees.getMe
);

router.get(
  '/removed',
  authorize('admin'),
  employees.listRemovedEmployees
);

router.get(
  '/export.csv',
  authorize('admin'),
  employees.exportEmployeesCsv
);

router.post(
  '/import',
  authorize('admin'),
  uploadCsv.single(
    'file'
  ),
  importEmployeesCsvWithTemporaryPasswords
);

router.get(
  '/',
  employees.listEmployees
);

/*
 * Direct Employee / Manager creation now uses a cryptographically random
 * temporary password and forces the user to change it after first login.
 */
router.post(
  '/',
  authorize('admin'),
  validateEmployeeManager,
  createEmployeeWithTemporaryPassword
);

router.get(
  '/:id',
  employees.getEmployee
);

router.patch(
  '/:id',
  authorize('admin'),
  validateEmployeeManager,
  employees.updateEmployee
);

router.patch(
  '/:id/complete-pending',
  authorize('admin'),
  completePendingEmployeeWithTemporaryPassword
);

router.patch(
  '/:id/remove',
  authorize('admin'),
  employees.removeEmployee
);

router.patch(
  '/:id/restore',
  authorize('admin'),
  employees.restoreEmployee
);

export default router;
