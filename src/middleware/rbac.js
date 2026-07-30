const { ForbiddenError } = require('../utils/errors');

const ROLE_HIERARCHY = {
  'Super Admin': 100,
  'Admin': 90,
  'HR Manager': 70,
  'Manager': 50,
  'Team Lead': 30,
  'Employee': 10,
};

function getRoleLevel(roleName) {
  return ROLE_HIERARCHY[roleName] || 0;
}

/**
 * Restrict to specific roles.
 * Usage: restrictTo('Admin', 'HR Manager')
 */
function restrictTo(...roles) {
  return (req, res, next) => {
    if (!req.employee || !req.employee.role) {
      return next(new ForbiddenError('No role assigned.'));
    }
    const roleName = req.employee.role.name || req.user.role;
    if (!roles.includes(roleName)) {
      return next(new ForbiddenError(`This action requires one of: ${roles.join(', ')}.`));
    }
    next();
  };
}

/**
 * Restrict to roles at or above a minimum hierarchy level.
 */
function restrictToMinLevel(minLevel) {
  return (req, res, next) => {
    if (!req.employee || !req.employee.role) {
      return next(new ForbiddenError('No role assigned.'));
    }
    const roleName = req.employee.role.name || req.user.role;
    if (getRoleLevel(roleName) < minLevel) {
      return next(new ForbiddenError('You do not have sufficient privileges.'));
    }
    next();
  };
}

/**
 * Check if the employee has a specific permission via their Role document.
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.employee || !req.employee.role) {
      return next(new ForbiddenError('No role assigned.'));
    }
    const role = req.employee.role;
    if (!role.permissions || !role.permissions.includes(permission)) {
      return next(new ForbiddenError(`Missing permission: ${permission}`));
    }
    next();
  };
}

/**
 * Allow access only to the owner or higher-privileged roles.
 */
function ownerOrHigher(ownerIdField = 'employee') {
  return (req, res, next) => {
    if (!req.employee) return next(new ForbiddenError('No employee context.'));
    const ownerId = req.params[ownerIdField] || req.params.id;
    const isOwner = req.employee._id.toString() === ownerId?.toString();
    const roleName = req.employee.role?.name || req.user.role;
    const isPrivileged = getRoleLevel(roleName) >= 50;

    if (!isOwner && !isPrivileged) {
      return next(new ForbiddenError('You can only access your own records.'));
    }
    next();
  };
}

module.exports = {
  restrictTo,
  restrictToMinLevel,
  requirePermission,
  ownerOrHigher,
  getRoleLevel,
  ROLE_HIERARCHY,
};
