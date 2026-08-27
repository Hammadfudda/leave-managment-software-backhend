import {
  Router,
} from 'express';

import * as employees from '../controllers/employee.controller.js';

import {
  exportEmployeesCsv,
} from '../controllers/employeeExport.controller.js';

import {
  createEmployeeWithTemporaryPassword,
} from '../controllers/accountCreation.controller.js';

import {
  completePendingEmployeeWithTemporaryPassword,
  importEmployeesCsvWithTemporaryPasswords,
} from '../controllers/csvImportTemporaryPassword.controller.js';

import {
  previewSmartCsv,
  commitSmartCsv,
  retrySmartCsvCredentialEmails,
} from '../controllers/smartCsvImport.controller.js';

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
  exportEmployeesCsv
);

/*
 * Existing import route is preserved for backward compatibility.
 */
router.post(
  '/import',
  authorize('admin'),
  uploadCsv.single(
    'file'
  ),
  importEmployeesCsvWithTemporaryPasswords
);

/*
 * New Smart CSV flow.
 * Preview first, then commit with explicit Admin decisions.
 */
router.post(
  '/import-smart/preview',
  authorize('admin'),
  uploadCsv.single(
    'file'
  ),
  previewSmartCsv
);

router.post(
  '/import-smart/commit',
  authorize('admin'),
  uploadCsv.single(
    'file'
  ),
  commitSmartCsv
);

router.post(
  '/import-smart/retry-emails',
  authorize('admin'),
  retrySmartCsvCredentialEmails
);

router.get(
  '/',
  employees.listEmployees
);

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
