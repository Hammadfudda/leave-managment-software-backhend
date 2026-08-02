import AuditLog from '../models/AuditLog.js';

/**
 * Spec Part 8.2/8.3 — every state-changing action writes an AuditLog entry in
 * the same request. Audit writes must never silently break the action, but they
 * must also never be skipped, so failures are logged loudly.
 */
export async function audit(entry) {
  try {
    return await AuditLog.create(entry);
  } catch (err) {
    console.error('AUDIT WRITE FAILED', entry.action, err.message);
    return null;
  }
}

export const AUDIT_ACTIONS = [
  'CREATE_EMPLOYEE',
  'EDIT_EMPLOYEE',
  'REMOVE_EMPLOYEE',
  'RESTORE_EMPLOYEE',
  'PURGE_EMPLOYEE',
  'IMPORT_EMPLOYEES',
  'CREATE_GRADE',
  'EDIT_GRADE',
  'DELETE_GRADE',
  'CREATE_DEPARTMENT',
  'EDIT_DEPARTMENT',
  'DELETE_DEPARTMENT',
  'CREATE_DESIGNATION',
  'EDIT_DESIGNATION',
  'DELETE_DESIGNATION',
  'CREATE_ROLE',
  'EDIT_ROLE',
  'DELETE_ROLE',
  'CREATE_LEAVE_POLICY',
  'EDIT_LEAVE_POLICY',
  'SUBMIT_LEAVE',
  'APPROVE_LEAVE',
  'REJECT_LEAVE',
  'CANCEL_LEAVE',
  'EXTEND_LEAVE',
  'REQUEST_STOP_LEAVE',
];
