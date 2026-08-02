import LeaveRequest from '../models/LeaveRequest.js';
import LeavePolicy from '../models/LeavePolicy.js';
import Department from '../models/Department.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { calcCalendarDays, calcWorkingDays, getExcludedWeekendDates } from '../utils/dates.js';
import { getLeaveBalancesForUser } from '../services/balance.service.js';
import { checkApplicantScope, getAvailableLeaveTypesForUser } from '../services/eligibility.service.js';
import { notifyGatekeeper } from '../services/notification.service.js';
import {
  actOnBehalf,
  approveLeave,
  getCurrentTurnApproverIds,
  isCurrentTurnApprover,
  isRequiredApprover,
  rejectLeave,
} from '../services/approval.service.js';

/** Resolves the policy that governs this employee + leave type (Part 6.1). */
async function resolvePolicy(leaveType, user) {
  const candidates = await LeavePolicy.find({ leaveType });
  if (candidates.length === 0) {
    throw new ValidationError(`No leave policy is configured for "${leaveType}".`);
  }

  // Prefer the most specific policy that this user actually falls under.
  const scoped = candidates.filter((p) => checkApplicantScope(p, user) === null);
  if (scoped.length === 0) {
    throw new ForbiddenError(
      checkApplicantScope(candidates[0], user) || 'This leave type is not available to you.'
    );
  }

  const score = (p) =>
    (p.approvalRouting?.grade ? 4 : 0) +
    (p.approvalRouting?.department ? 2 : 0) +
    (p.approvalRouting?.designation ? 1 : 0);
  return scoped.sort((a, b) => score(b) - score(a))[0];
}

async function saturdayOffFor(departmentName) {
  const dept = await Department.findOne({ name: departmentName });
  return dept?.saturdayOff ?? true;
}

/** Adds derived, request-scoped view data the frontend needs (Part 5.5). */
function decorate(request, viewerId) {
  const obj = request.toObject ? request.toObject() : request;
  const turnIds = getCurrentTurnApproverIds(request);
  return {
    ...obj,
    currentTurnApproverIds: turnIds,
    isMyTurn: viewerId ? turnIds.includes(String(viewerId)) : false,
  };
}

/**
 * Spec Part 10.3 — role scoping is applied BEFORE query filters, always.
 *   Admin    → everything
 *   Manager  → own requests + anything they are a required approver on
 *   Employee → own requests only
 */
function scopeFor(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'manager') {
    return { $or: [{ employeeId: user._id }, { requiredApproverIds: user._id }] };
  }
  return { employeeId: user._id };
}

export const listLeaveRequests = asyncHandler(async (req, res) => {
  const filter = { ...scopeFor(req.currentUser) };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.leaveType) filter.leaveType = req.query.leaveType;
  if (req.query.department) filter.department = req.query.department;
  if (req.query.employeeName) {
    filter.employeeName = { $regex: String(req.query.employeeName).trim(), $options: 'i' };
  }
  if (req.query.employeeId) filter.employeeId = req.query.employeeId;
  if (req.query.isExtension !== undefined) filter.isExtension = req.query.isExtension === 'true';
  if (req.query.isStopRequest !== undefined) {
    filter.isStopRequest = req.query.isStopRequest === 'true';
  }
  if (req.query.from || req.query.to) {
    filter.startDate = {};
    if (req.query.from) filter.startDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.startDate.$lte = new Date(req.query.to);
  }

  const pagination = getPagination(req.query);
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    LeaveRequest.countDocuments(filter),
  ]);

  const data = items.map((r) => decorate(r, req.currentUser._id));
  res.json({ success: true, ...paginated(data, total, pagination) });
});

export const getLeaveRequest = asyncHandler(async (req, res) => {
  const request = await LeaveRequest.findById(req.params.id);
  if (!request) throw new NotFoundError();

  const isOwner = String(request.employeeId) === String(req.currentUser._id);
  const involved =
    req.currentUser.role === 'admin' || isOwner || isRequiredApprover(request, req.currentUser._id);
  // Part 9.2 — someone with no business seeing this request gets a 404, not a
  // 403. A 403 would confirm the record exists.
  if (!involved) throw new NotFoundError();

  res.json({ success: true, data: decorate(request, req.currentUser._id) });
});

/** GET /api/leave-requests/available-types — drives the submission dropdown. */
export const listAvailableLeaveTypes = asyncHandler(async (req, res) => {
  const types = await getAvailableLeaveTypesForUser(req.currentUser);
  res.json({ success: true, data: [...new Set(types)] });
});

/**
 * Spec Part 5.1 / 6 — submission.
 * Admin never submits leave for anyone, including themselves: there is
 * deliberately no employeeId parameter here. The applicant is always the
 * authenticated user.
 */
export const createLeaveRequest = asyncHandler(async (req, res) => {
  const user = req.currentUser;
  const { leaveType, startDate, endDate, reason } = req.body;

  if (!leaveType || !startDate || !endDate || !reason) {
    throw new ValidationError('Leave type, start date, end date and reason are all required.');
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError('Invalid dates supplied.');
  }
  if (end < start) throw new ValidationError('End date cannot be before the start date.');

  const policy = await resolvePolicy(leaveType, user);

  if (policy.documentRequirement === 'required' && !req.file) {
    throw new ValidationError('A supporting document is required for this leave type.');
  }

  const saturdayOff = await saturdayOffFor(user.department);
  const totalWorkingDays = calcWorkingDays(start, end, saturdayOff);
  if (totalWorkingDays === 0) {
    throw new ValidationError('The selected range contains no working days.');
  }

  const request = await LeaveRequest.create({
    employeeId: user._id,
    employeeName: user.fullName,
    department: user.department,
    leaveType,
    startDate: start,
    endDate: end,
    totalDaysRequested: calcCalendarDays(start, end),
    totalWorkingDays,
    excludedWeekendDates: getExcludedWeekendDates(start, end, saturdayOff),
    reason,
    attachmentUrl: req.file?.path,
    attachmentName: req.file?.originalname,
    // Snapshot the chain at submission time. Later policy edits must not
    // retroactively re-route a request that is already in flight.
    requiredApproverIds: policy.approvalRouting.approverIds,
    status: 'pending',
  });

  await notifyGatekeeper(request, 'leave_pending_approval');
  await audit({
    actorId: user._id,
    actorName: user.fullName,
    action: 'SUBMIT_LEAVE',
    targetType: 'LeaveRequest',
    targetId: request._id,
    affectedPerson: user.fullName,
    department: user.department,
    leaveType,
    details: `${totalWorkingDays} working day(s)`,
  });

  res.status(201).json({ success: true, data: decorate(request, user._id) });
});

export const approve = asyncHandler(async (req, res) => {
  const request = await approveLeave(req.params.id, req.currentUser, req.body.comment);
  res.json({ success: true, data: decorate(request, req.currentUser._id) });
});

export const reject = asyncHandler(async (req, res) => {
  if (!req.body.comment) {
    throw new ValidationError('A comment is required when rejecting a request.');
  }
  const request = await rejectLeave(req.params.id, req.currentUser, req.body.comment);
  res.json({ success: true, data: decorate(request, req.currentUser._id) });
});

/** Spec Part 5.3 — Admin fills ONE named approver's slot. The chain continues. */
export const actOnBehalfOf = asyncHandler(async (req, res) => {
  const { approverId, action, comment } = req.body;
  if (!approverId) throw new ValidationError('approverId is required.');
  if (!['approved', 'rejected'].includes(action)) {
    throw new ValidationError('action must be "approved" or "rejected".');
  }
  const request = await actOnBehalf(req.params.id, req.currentUser, approverId, action, comment);
  res.json({ success: true, data: decorate(request, req.currentUser._id) });
});

/** Shared guard for extend/stop: own, approved, and not finished yet (Part 7). */
async function loadActiveOwnLeave(requestId, user) {
  const original = await LeaveRequest.findById(requestId);
  if (!original) throw new NotFoundError();
  if (String(original.employeeId) !== String(user._id)) {
    // Not yours — 404 rather than 403, same reasoning as getLeaveRequest.
    throw new NotFoundError();
  }
  if (original.status !== 'approved') {
    throw new ForbiddenError('Only an approved leave request can be modified.');
  }
  const effectiveEnd = original.actualEndDate || original.endDate;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(effectiveEnd) < today) {
    throw new ForbiddenError('This leave has already ended.');
  }
  return original;
}

/**
 * Spec Part 7.1 — extension. A brand new pending LeaveRequest, never a mutation
 * of the original. It runs the full approval chain again on its own.
 */
export const extendLeave = asyncHandler(async (req, res) => {
  const user = req.currentUser;
  const original = await loadActiveOwnLeave(req.params.id, user);

  const { newEndDate, reason } = req.body;
  if (!newEndDate || !reason) {
    throw new ValidationError('A new end date and a reason are required.');
  }
  const end = new Date(newEndDate);
  const currentEnd = new Date(original.actualEndDate || original.endDate);
  if (Number.isNaN(end.getTime())) throw new ValidationError('Invalid date supplied.');
  if (end <= currentEnd) {
    throw new ValidationError('The new end date must be after the current end date.');
  }

  // The extension covers only the *added* stretch, starting the day after the
  // original ends — so approving it can never double-count the original days.
  const start = new Date(currentEnd);
  start.setDate(start.getDate() + 1);

  const saturdayOff = await saturdayOffFor(user.department);
  const totalWorkingDays = calcWorkingDays(start, end, saturdayOff);
  if (totalWorkingDays === 0) {
    throw new ValidationError('The extension contains no working days.');
  }

  const policy = await resolvePolicy(original.leaveType, user);

  const extension = await LeaveRequest.create({
    employeeId: user._id,
    employeeName: user.fullName,
    department: user.department,
    leaveType: original.leaveType,
    startDate: start,
    endDate: end,
    totalDaysRequested: calcCalendarDays(start, end),
    totalWorkingDays,
    excludedWeekendDates: getExcludedWeekendDates(start, end, saturdayOff),
    reason,
    isExtension: true,
    originalRequestId: original._id,
    isPaidOverride: req.body.isPaidOverride ?? null,
    requiredApproverIds: policy.approvalRouting.approverIds,
    status: 'pending',
  });

  await notifyGatekeeper(extension, 'extension_requested');
  await audit({
    actorId: user._id,
    actorName: user.fullName,
    action: 'EXTEND_LEAVE',
    targetType: 'LeaveRequest',
    targetId: extension._id,
    affectedPerson: user.fullName,
    department: user.department,
    leaveType: original.leaveType,
    details: `Extension of ${original._id} to ${end.toISOString().split('T')[0]}`,
  });

  res.status(201).json({ success: true, data: decorate(extension, user._id) });
});

/**
 * Spec Part 7.2 — stop-early. Also a brand new pending request. Nothing about
 * the original changes and no balance is restored until this is APPROVED; the
 * restore happens in approval.service.applyStopEffect.
 */
export const requestStopLeave = asyncHandler(async (req, res) => {
  const user = req.currentUser;
  const original = await loadActiveOwnLeave(req.params.id, user);

  const { returnDate, reason } = req.body;
  if (!returnDate || !reason) {
    throw new ValidationError('A return date and a reason are required.');
  }
  const stopDate = new Date(returnDate);
  if (Number.isNaN(stopDate.getTime())) throw new ValidationError('Invalid date supplied.');
  if (stopDate < new Date(original.startDate)) {
    throw new ValidationError('The return date cannot be before the leave started.');
  }
  if (stopDate >= new Date(original.actualEndDate || original.endDate)) {
    throw new ValidationError('The return date must be before the current end date.');
  }

  const policy = await resolvePolicy(original.leaveType, user);

  const stopRequest = await LeaveRequest.create({
    employeeId: user._id,
    employeeName: user.fullName,
    department: user.department,
    leaveType: original.leaveType,
    startDate: original.startDate,
    endDate: stopDate,
    totalDaysRequested: 0,
    // A stop-request consumes nothing itself; its job is to shrink the original.
    totalWorkingDays: 0,
    reason,
    isStopRequest: true,
    originalRequestId: original._id,
    requiredApproverIds: policy.approvalRouting.approverIds,
    status: 'pending',
  });

  await notifyGatekeeper(stopRequest, 'stop_requested');
  await audit({
    actorId: user._id,
    actorName: user.fullName,
    action: 'REQUEST_STOP_LEAVE',
    targetType: 'LeaveRequest',
    targetId: stopRequest._id,
    affectedPerson: user.fullName,
    department: user.department,
    leaveType: original.leaveType,
    details: `Requested to return on ${stopDate.toISOString().split('T')[0]}`,
  });

  res.status(201).json({ success: true, data: decorate(stopRequest, user._id) });
});

/** Employees may only read their own balance; managers/admins may read anyone's. */
export const getBalance = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const isSelf = String(employeeId) === String(req.currentUser._id);
  if (!isSelf && req.currentUser.role === 'employee') throw new NotFoundError();

  const employee = await User.findById(employeeId);
  if (!employee) throw new NotFoundError();

  const balances = await getLeaveBalancesForUser(employeeId);
  res.json({ success: true, data: balances });
});

export { isCurrentTurnApprover };
