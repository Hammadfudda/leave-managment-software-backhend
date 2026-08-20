import {
  Router,
} from 'express';

import * as employees from '../controllers/employee.controller.js';

import {
  completePendingEmployee,
  importEmployeesCsvPending,
} from '../controllers/csvImport.controller.js';

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

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

router.use(
  authenticate,
  loadUser
);

/*
|--------------------------------------------------------------------------
| STATIC ROUTES
|--------------------------------------------------------------------------
|
| These MUST stay before /:id.
|
*/

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
  importEmployeesCsvPending
);

/*
|--------------------------------------------------------------------------
| EMPLOYEE LIST
|--------------------------------------------------------------------------
*/

router.get(
  '/',
  employees.listEmployees
);

/*
|--------------------------------------------------------------------------
| CREATE EMPLOYEE
|--------------------------------------------------------------------------
|
| Existing strict Create Employee flow is unchanged.
|
*/

router.post(
  '/',
  authorize('admin'),
  validateEmployeeManager,
  employees.createEmployee
);

/*
|--------------------------------------------------------------------------
| GET ONE EMPLOYEE
|--------------------------------------------------------------------------
*/

router.get(
  '/:id',
  employees.getEmployee
);

/*
|--------------------------------------------------------------------------
| UPDATE EMPLOYEE
|--------------------------------------------------------------------------
|
| Existing update controller stays unchanged.
|
*/

router.patch(
  '/:id',
  authorize('admin'),
  validateEmployeeManager,
  employees.updateEmployee
);

/*
|--------------------------------------------------------------------------
| COMPLETE PENDING CSV DETAILS
|--------------------------------------------------------------------------
|
| This endpoint is only called after the existing normal update succeeds.
|
*/

router.patch(
  '/:id/complete-pending',
  authorize('admin'),
  completePendingEmployee
);

/*
|--------------------------------------------------------------------------
| SOFT REMOVE
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/remove',
  authorize('admin'),
  employees.removeEmployee
);

/*
|--------------------------------------------------------------------------
| RESTORE
|--------------------------------------------------------------------------
*/

router.patch(
  '/:id/restore',
  authorize('admin'),
  employees.restoreEmployee
);

export default router;
