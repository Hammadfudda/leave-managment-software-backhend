import AuditLog from '../models/AuditLog.js';

/*
 * Existing callers still pass one argument.
 * Transactional callers may provide { session }.
 */
export async function audit(
  entry,
  options = {}
) {
  try {
    if (options.session) {
      const rows =
        await AuditLog.create(
          [entry],
          {
            session:
              options.session,
          }
        );

      return rows[0];
    }

    return await AuditLog.create(
      entry
    );
  } catch (err) {
    console.error(
      'AUDIT WRITE FAILED',
      entry.action,
      err.message
    );

    /*
     * Existing non-transactional callers preserve the previous best-effort
     * audit behavior. For Admin override/stop transactions, an audit failure
     * must abort the transaction so balance + leave state cannot commit
     * without its required audit entry.
     */
    if (options.session) {
      throw err;
    }

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
  'EDIT_LEAVE_YEAR_START',
  'ADMIN_OVERRIDE_LEAVE',
  'ADMIN_STOP_LEAVE',
];
