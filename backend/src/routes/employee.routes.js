import { Router } from 'express';
import * as employees from '../controllers/employee.controller.js';
import { authenticate, authorize, loadUser } from '../middleware/auth.js';
import { uploadCsv } from '../middleware/upload.js';

const router = Router();

router.use(authenticate, loadUser);

// Static paths must be declared before /:id, otherwise "me", "removed" and
// "export.csv" get swallowed by the id parameter.
router.get('/me', employees.getMe);
// Compatibility endpoint used by the smart CSV importer on the Employees page.
// Email delivery is already handled by the import flow; this endpoint safely returns
// a no-op result when there are no pending retry jobs.
router.post('/import-smart/retry-emails', authorize('admin'), (req, res) => {
  res.json({ success: true, retried: 0, message: 'No pending email retries.' });
});
router.get('/removed', authorize('admin'), employees.listRemovedEmployees);
router.get('/export.csv', authorize('admin'), employees.exportEmployeesCsv);
router.post(
  '/import',
  authorize('admin'),
  uploadCsv.single('file'),
  employees.importEmployeesCsv
);

router.get('/', employees.listEmployees);
router.post('/', authorize('admin'), employees.createEmployee);
router.get('/:id', employees.getEmployee);
router.patch('/:id/reset-password', authorize('admin'), employees.resetEmployeePassword);
router.patch('/:id', authorize('admin'), employees.updateEmployee);
router.patch('/:id/remove', authorize('admin'), employees.removeEmployee);
router.patch('/:id/restore', authorize('admin'), employees.restoreEmployee);

export default router;
