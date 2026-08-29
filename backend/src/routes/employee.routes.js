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
  updateEmployeeRoleLabel,
} from '../controllers/employeeRoleLabel.controller.js';

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
  previewSmartCsvMetadata,
  commitSmartCsvMetadata,
} from '../controllers/smartCsvMetadata.controller.js';

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

import {
  validateSmartCsvRequirements,
} from '../middleware/smartCsvRequirements.js';

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
  authorize(
    'admin'
  ),
  employees.listRemovedEmployees
);

router.get(
  '/export.csv',
  authorize(
    'admin'
  ),
  exportEmployeesCsv
);

/*
 * Legacy CSV import remains unchanged.
 */
router.post(
  '/import',
  authorize(
    'admin'
  ),
  uploadCsv.single(
    'file'
  ),
  importEmployeesCsvWithTemporaryPasswords
);

/*
 * Smart CSV remains preview-first and keeps the mature Manager / permissions
 * controller. The new middleware only adds confirmed blocking validation for
 * Division, Leave Year Start and Grade + Leave Type quota conflicts.
 */
router.post(
  '/import-smart/preview',
  authorize(
    'admin'
  ),
  uploadCsv.single(
    'file'
  ),
  validateSmartCsvRequirements,
  previewSmartCsv
);

router.post(
  '/import-smart/commit',
  authorize(
    'admin'
  ),
  uploadCsv.single(
    'file'
  ),
  validateSmartCsvRequirements,
  commitSmartCsv
);

/*
 * Companion metadata endpoints now mean Division + initial Used values.
 */
router.post(
  '/import-smart/metadata-preview',
  authorize(
    'admin'
  ),
  uploadCsv.single(
    'file'
  ),
  validateSmartCsvRequirements,
  previewSmartCsvMetadata
);

router.post(
  '/import-smart/metadata-commit',
  authorize(
    'admin'
  ),
  uploadCsv.single(
    'file'
  ),
  validateSmartCsvRequirements,
  commitSmartCsvMetadata
);

router.post(
  '/import-smart/retry-emails',
  authorize(
    'admin'
  ),
  retrySmartCsvCredentialEmails
);

router.get(
  '/',
  employees.listEmployees
);

router.post(
  '/',
  authorize(
    'admin'
  ),
  validateEmployeeManager,
  createEmployeeWithTemporaryPassword
);

/*
 * Existing route path retained; user-visible meaning is Division.
 */
router.patch(
  '/:id/role-label',
  authorize(
    'admin'
  ),
  updateEmployeeRoleLabel
);

router.get(
  '/:id',
  employees.getEmployee
);

router.patch(
  '/:id',
  authorize(
    'admin'
  ),
  validateEmployeeManager,
  employees.updateEmployee
);

router.patch(
  '/:id/complete-pending',
  authorize(
    'admin'
  ),
  completePendingEmployeeWithTemporaryPassword
);

router.patch(
  '/:id/remove',
  authorize(
    'admin'
  ),
  employees.removeEmployee
);

router.patch(
  '/:id/restore',
  authorize(
    'admin'
  ),
  employees.restoreEmployee
);

export default router;
