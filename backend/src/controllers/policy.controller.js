import LeavePolicy from '../models/LeavePolicy.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { getEligibleApprovers } from '../services/eligibility.service.js';
import { getPagination, paginated } from '../utils/pagination.js';

/**
 * Spec Part 6.1/6.2 — Leave policies.
 *
 * The single most important invariant here: approvalRouting.designation /
 * department / grade describe WHO THE POLICY APPLIES TO. approverIds describes
 * WHO APPROVES IT. They are independent. Never derive one from the other.
 */

function normalizeRouting(body) {
  const routing = body.approvalRouting || {};
  const approverIds = Array.isArray(routing.approverIds) ? routing.approverIds : [];
  return {
    designation: routing.designation || null,
    department: routing.department || null,
    grade: routing.grade || null,
    // Order is meaningful: index 0 is the gatekeeper (Part 5). Dedupe without
    // sorting so the admin's chosen order survives exactly as entered.
    approverIds: [...new Set(approverIds.map(String))],
  };
}

/** Admin sees everything; a manager only sees policies they are an approver on. */
export const listPolicies = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.currentUser.role !== 'admin') {
    filter['approvalRouting.approverIds'] = req.currentUser._id;
  }
  if (req.query.department) filter['approvalRouting.department'] = req.query.department;
  if (req.query.leaveType) filter.leaveType = req.query.leaveType;

  const pagination = getPagination(req.query);
  const [items, total] = await Promise.all([
    LeavePolicy.find(filter)
      .populate('approvalRouting.approverIds', 'fullName email role department designation')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    LeavePolicy.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(items, total, pagination) });
});

export const createPolicy = asyncHandler(async (req, res) => {
  const { leaveType, applicableRole, isPaid, minDaysNoticeRequired, documentRequirement } = req.body;
  if (!leaveType) throw new ValidationError('Leave type is required.');

  const approvalRouting = normalizeRouting(req.body);
  if (approvalRouting.approverIds.length === 0) {
    throw new ValidationError('At least one approver is required.');
  }

  // Every approver must actually exist and be an active admin or manager.
  const approvers = await User.find({
    _id: { $in: approvalRouting.approverIds },
    role: { $in: ['admin', 'manager'] },
    status: 'active',
  });
  if (approvers.length !== approvalRouting.approverIds.length) {
    throw new ValidationError('One or more selected approvers are not valid active approvers.');
  }

  const policy = await LeavePolicy.create({
    leaveType,
    applicableRole: applicableRole || 'All Employees',
    isPaid: isPaid !== undefined ? Boolean(isPaid) : true,
    // Advisory only — Part 6.2 is explicit that notice period never blocks a
    // submission, it is shown to approvers as context.
    minDaysNoticeRequired: Number(minDaysNoticeRequired) || 0,
    documentRequirement: documentRequirement || 'optional',
    approvalRouting,
  });

  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'CREATE_LEAVE_POLICY',
    targetType: 'LeavePolicy',
    targetId: policy._id,
    leaveType: policy.leaveType,
    department: approvalRouting.department,
    details: `Created ${policy.leaveType} policy with ${approvalRouting.approverIds.length} approver(s)`,
  });

  res.status(201).json({ success: true, data: policy });
});

export const updatePolicy = asyncHandler(async (req, res) => {
  const policy = await LeavePolicy.findById(req.params.id);
  if (!policy) throw new NotFoundError();

  const { leaveType, applicableRole, isPaid, minDaysNoticeRequired, documentRequirement } = req.body;
  if (leaveType !== undefined) policy.leaveType = leaveType;
  if (applicableRole !== undefined) policy.applicableRole = applicableRole;
  if (isPaid !== undefined) policy.isPaid = Boolean(isPaid);
  if (minDaysNoticeRequired !== undefined) {
    policy.minDaysNoticeRequired = Number(minDaysNoticeRequired) || 0;
  }
  if (documentRequirement !== undefined) policy.documentRequirement = documentRequirement;

  if (req.body.approvalRouting) {
    const approvalRouting = normalizeRouting(req.body);
    if (approvalRouting.approverIds.length === 0) {
      throw new ValidationError('At least one approver is required.');
    }
    const approvers = await User.find({
      _id: { $in: approvalRouting.approverIds },
      role: { $in: ['admin', 'manager'] },
      status: 'active',
    });
    if (approvers.length !== approvalRouting.approverIds.length) {
      throw new ValidationError('One or more selected approvers are not valid active approvers.');
    }
    policy.approvalRouting = approvalRouting;
  }

  await policy.save();

  // NOTE: already-submitted requests keep the chain they were created with.
  // Re-routing a policy must never retroactively change a pending request's
  // approvers — that would strand requests mid-chain.
  await audit({
    actorId: req.currentUser._id,
    actorName: req.currentUser.fullName,
    action: 'EDIT_LEAVE_POLICY',
    targetType: 'LeavePolicy',
    targetId: policy._id,
    leaveType: policy.leaveType,
    details: `Updated ${policy.leaveType} policy`,
  });

  res.json({ success: true, data: policy });
});

/**
 * Spec Part 6.2 — who Admin may pick as an approver for a given department.
 * Admins always qualify. Managers qualify for their own department, or for any
 * department when canApproveOtherDepartments is explicitly granted.
 */
export const listEligibleApprovers = asyncHandler(async (req, res) => {
  const approvers = await getEligibleApprovers(req.query.department);
  res.json({
    success: true,
    data: approvers.map((u) => ({
      _id: u._id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      department: u.department,
      designation: u.designation,
      canApproveOtherDepartments: u.canApproveOtherDepartments,
    })),
  });
});
