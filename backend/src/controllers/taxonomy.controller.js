import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import RoleLabel from '../models/RoleLabel.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { syncQuotasToGrade } from '../services/balance.service.js';

/**
 * Spec Part 2.2–2.5 + Part 11 — the four admin-maintained lookup lists.
 *
 * They share one shape, so they share one factory. The differences that matter
 * are encoded per-entity: which fields are writable, what the audit action
 * names are, and — critically — what blocks a delete. A lookup value that is
 * still referenced by a User is never deleted; doing so would leave employees
 * pointing at a missing grade/department and break their balances silently.
 */
function crudFactory({ Model, label, actions, writableFields, inUseCheck, afterUpdate }) {
  const pick = (body) => {
    const out = {};
    for (const field of writableFields) {
      if (body[field] !== undefined) out[field] = body[field];
    }
    return out;
  };

  return {
    list: asyncHandler(async (req, res) => {
      const items = await Model.find({}).sort({ name: 1 });
      res.json({ success: true, data: items });
    }),

    create: asyncHandler(async (req, res) => {
      const payload = pick(req.body);
      if (!payload.name) throw new ValidationError(`${label} name is required.`);

      const existing = await Model.findOne({ name: payload.name });
      if (existing) throw new ConflictError(`A ${label.toLowerCase()} with that name already exists.`);

      const item = await Model.create(payload);
      await audit({
        actorId: req.currentUser._id,
        actorName: req.currentUser.fullName,
        action: actions.create,
        targetType: Model.modelName,
        targetId: item._id,
        details: `Created ${label.toLowerCase()} "${item.name}"`,
      });
      res.status(201).json({ success: true, data: item });
    }),

    update: asyncHandler(async (req, res) => {
      const item = await Model.findById(req.params.id);
      if (!item) throw new NotFoundError();

      const payload = pick(req.body);
      if (payload.name && payload.name !== item.name) {
        const clash = await Model.findOne({ name: payload.name, _id: { $ne: item._id } });
        if (clash) throw new ConflictError(`A ${label.toLowerCase()} with that name already exists.`);
      }

      const previousName = item.name;
      Object.assign(item, payload);
      await item.save();

      if (afterUpdate) await afterUpdate(item, previousName);

      await audit({
        actorId: req.currentUser._id,
        actorName: req.currentUser.fullName,
        action: actions.update,
        targetType: Model.modelName,
        targetId: item._id,
        details: `Updated ${label.toLowerCase()} "${previousName}"`,
      });
      res.json({ success: true, data: item });
    }),

    remove: asyncHandler(async (req, res) => {
      const item = await Model.findById(req.params.id);
      if (!item) throw new NotFoundError();

      const inUse = await inUseCheck(item);
      if (inUse > 0) {
        throw new ConflictError(
          `This ${label.toLowerCase()} is assigned to ${inUse} employee(s) and cannot be deleted.`
        );
      }

      await item.deleteOne();
      await audit({
        actorId: req.currentUser._id,
        actorName: req.currentUser.fullName,
        action: actions.delete,
        targetType: Model.modelName,
        targetId: item._id,
        details: `Deleted ${label.toLowerCase()} "${item.name}"`,
      });
      res.json({ success: true, message: `${label} deleted.` });
    }),
  };
}

export const grades = crudFactory({
  Model: Grade,
  label: 'Grade',
  actions: { create: 'CREATE_GRADE', update: 'EDIT_GRADE', delete: 'DELETE_GRADE' },
  writableFields: [
    'name',
    'annualLeaveQuota',
    'sickLeaveQuota',
    'casualLeaveQuota',
    'carryForwardAllowed',
    'maxCarryForwardDays',
    'description',
  ],
  inUseCheck: (grade) => User.countDocuments({ gradeId: grade._id, status: { $ne: 'inactive' } }),
  // Editing a grade's quotas must flow through to everyone on it. `used` is
  // preserved, only `quota` moves, so nobody loses days they already took.
  afterUpdate: async (grade) => {
    const holders = await User.find({ gradeId: grade._id }).select('_id');
    for (const holder of holders) {
      await syncQuotasToGrade(holder._id, grade);
    }
  },
});

export const departments = crudFactory({
  Model: Department,
  label: 'Department',
  actions: {
    create: 'CREATE_DEPARTMENT',
    update: 'EDIT_DEPARTMENT',
    delete: 'DELETE_DEPARTMENT',
  },
  // Departments are stored on User by name, so a rename has to cascade.
  writableFields: ['name', 'saturdayOff'],
  inUseCheck: (dept) => User.countDocuments({ department: dept.name, status: { $ne: 'inactive' } }),
  afterUpdate: async (dept, previousName) => {
    if (previousName !== dept.name) {
      await User.updateMany({ department: previousName }, { $set: { department: dept.name } });
    }
  },
});

export const designations = crudFactory({
  Model: Designation,
  label: 'Designation',
  actions: {
    create: 'CREATE_DESIGNATION',
    update: 'EDIT_DESIGNATION',
    delete: 'DELETE_DESIGNATION',
  },
  writableFields: ['name'],
  inUseCheck: (d) => User.countDocuments({ designation: d.name, status: { $ne: 'inactive' } }),
  afterUpdate: async (d, previousName) => {
    if (previousName !== d.name) {
      await User.updateMany({ designation: previousName }, { $set: { designation: d.name } });
    }
  },
});

/**
 * HR label list only (Part 2.5). Deleting one can never affect access control,
 * because User.role is a separate fixed enum that this list does not touch.
 */
export const roles = crudFactory({
  Model: RoleLabel,
  label: 'Role',
  actions: { create: 'CREATE_ROLE', update: 'EDIT_ROLE', delete: 'DELETE_ROLE' },
  writableFields: ['name'],
  inUseCheck: async () => 0,
});
