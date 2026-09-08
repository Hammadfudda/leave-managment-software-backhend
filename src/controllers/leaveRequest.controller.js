const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const LeavePolicy = require('../models/LeavePolicy');
const Holiday = require('../models/Holiday');
const { NotFoundError, ValidationError, ForbiddenError, ConflictError, AppError } = require('../utils/errors');
const { asyncHandler } = require('../utils/asyncHandler');
const { logAudit } = require('../middleware/auditLog');
const { calculateLeaveDays } = require('../utils/dateUtils');
const { hasSufficientBalance, recalculateLeaveBalance, getAvailableBalance } = require('../utils/leaveBalance');
const { buildApprovalChain } = require('../utils/approvalChain');
const { processApproval } = require('../services/approvalService');
const { createNotification } = require('../services/notificationService');

exports.createLeaveRequest = asyncHandler(async (req, res) => {
  const { leaveType, startDate, endDate, session = 'full_day', endSession = 'full_day', reason, attachment } = req.body;

  if (!leaveType || !startDate || !endDate || !reason) {
    throw new ValidationError('leaveType, startDate, endDate, reason are required.');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) throw new ValidationError('Start date cannot be after end date.');
  if (start < new Date(new Date().toDateString())) throw new ValidationError('Cannot request leave for a past date.');

  const employee = await Employee.findById(req.employee._id).populate('leavePolicy role manager teamLead');
  if (!employee) throw new NotFoundError('Employee');

  if (!employee.leavePolicy) throw new ValidationError('No leave policy assigned. Contact HR.');

  const policy = await LeavePolicy.findById(employee.leavePolicy);
  if (!policy) throw new NotFoundError('Leave policy');

  const leaveTypeConfig = policy.leaveTypes.find((lt) => lt.type === leaveType);
  if (!leaveTypeConfig) throw new ValidationError(`Leave type '${leaveType}' is not available in your policy.`);

  // Gender check
  if (leaveTypeConfig.applicableGenders && !leaveTypeConfig.applicableGenders.includes(employee.gender)) {
    throw new ValidationError(`Leave type '${leaveType}' is not applicable to your gender.`);
  }

  // Attachment required?
  if (leaveTypeConfig.requiresAttachment && (!attachment || !attachment.url)) {
    throw new ValidationError(`Attachment is required for ${leaveType} leave.`);
  }

  // Half-day validation
  if (session !== 'full_day' && start.getTime() === end.getTime() && endSession !== 'full_day') {
    throw new ValidationError('Cannot have half-day sessions on both start and end of a single day.');
  }

  // Overlap check
  const overlap = await LeaveRequest.findOne({
    employee: employee._id,
    status: { $in: ['pending', 'approved'] },
    $or: [
      { startDate: { $lte: end }, endDate: { $gte: start } },
    ],
  });
  if (overlap) throw new ConflictError('You already have a leave request overlapping these dates.');

  // Fetch holidays for day calculation
  const holidays = await Holiday.find({ date: { $gte: start, $lte: end } });
  const holidayDates = holidays.map((h) => h.date);

  const totalDays = calculateLeaveDays(start, end, {
    startSession: session,
    endSession,
    weekendPolicy: policy.weekendPolicy,
  }, holidayDates);

  if (totalDays === 0) throw new ValidationError('Selected dates fall on weekends/holidays only.');

  // Balance check (unpaid is always allowed)
  if (leaveType !== 'unpaid') {
    const hasBalance = await hasSufficientBalance(employee._id, leaveType, totalDays);
    if (!hasBalance) {
      const available = getAvailableBalance(employee, leaveType);
      throw new ValidationError(`Insufficient leave balance. Requested: ${totalDays} day(s), available: ${available} day(s).`);
    }
  }

  // Build approval chain
  let approvals = await buildApprovalChain(employee);

  // If no teamLead/manager, auto-approve by HR (or mark for HR)
  if (approvals.length === 0) {
    // No approvers defined - mark as pending with no stages (HR can act)
    approvals = [];
  }

  const leaveRequest = await LeaveRequest.create({
    employee: employee._id,
    leaveType,
    startDate: start,
    endDate: end,
    session,
    endSession,
    reason,
    attachment: attachment || { url: '', publicId: '' },
    totalDays,
    isPaid: leaveTypeConfig.isPaid,
    approvals,
    currentStage: 0,
    status: approvals.length === 0 ? 'pending' : 'pending',
    history: [{
      action: 'created',
      by: employee._id,
      comment: 'Leave request submitted',
      at: new Date(),
    }],
  });

  // Notify first approver
  if (approvals.length > 0) {
    const firstApprover = await Employee.findById(approvals[0].approver);
    if (firstApprover) {
      await createNotification({
        recipient: firstApprover._id,
        type: 'leave_request_submitted',
        title: 'New leave request pending approval',
        message: `${employee.firstName} ${employee.lastName} requested ${leaveType} leave from ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}.`,
        relatedLeave: leaveRequest._id,
        channel: 'both',
        recipientEmail: firstApprover.email,
        recipientName: `${firstApprover.firstName} ${firstApprover.lastName}`,
        leaveDetails: {
          leaveType, startDate: start.toISOString().split('T')[0], endDate: end.toISOString().split('T')[0],
          totalDays, reason,
        },
      });
    }
  }

  // Add pending to balance
  await recalculateLeaveBalance(employee._id);

  await logAudit({
    actor: employee._id,
    actorRole: employee.role?.name,
    action: 'create_leave_request',
    target: leaveRequest._id,
    targetModel: 'LeaveRequest',
    description: `Leave request created: ${leaveType} ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
    req,
  });

  res.status(201).json({ status: 'success', message: 'Leave request submitted.', data: { leaveRequest } });
});

exports.getLeaveRequests = asyncHandler(async (req, res) => {
  const {
    page = 1, limit = 20, status, leaveType, employeeId, startDate, endDate, sortBy = 'createdAt', order = 'desc',
  } = req.query;

  const filter = {};
  if (status) filter.status = status;
  if (leaveType) filter.leaveType = leaveType;
  if (employeeId) filter.employee = employeeId;
  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate) filter.startDate.$lte = new Date(endDate);
  }

  // Role-based filtering
  const requesterRole = req.employee?.role?.name || req.user?.role;
  if (requesterRole === 'Employee') {
    filter.employee = req.employee._id;
  } else if (requesterRole === 'Team Lead' || requesterRole === 'Manager') {
    // See own + team's requests
    const teamIds = await Employee.find({
      $or: [{ manager: req.employee._id }, { teamLead: req.employee._id }],
    }).distinct('_id');
    teamIds.push(req.employee._id);
    filter.employee = { $in: teamIds };
  }
  // HR/Admin/Super Admin see all

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const sortOrder = order === 'asc' ? 1 : -1;

  const [requests, total] = await Promise.all([
    LeaveRequest.find(filter)
      .populate('employee', 'firstName lastName email employeeId avatar')
      .populate('approvals.approver', 'firstName lastName')
      .populate('rejectedBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(parseInt(limit)),
    LeaveRequest.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      requests,
      pagination: {
        page: parseInt(page), limit: parseInt(limit), total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

exports.getLeaveRequestById = asyncHandler(async (req, res) => {
  const leaveRequest = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName email employeeId avatar')
    .populate('approvals.approver', 'firstName lastName')
    .populate('rejectedBy', 'firstName lastName')
    .populate('approvedBy', 'firstName lastName');

  if (!leaveRequest) throw new NotFoundError('Leave request');

  // Access control
  const requesterRole = req.employee?.role?.name || req.user?.role;
  const isOwner = leaveRequest.employee._id.toString() === req.employee._id.toString();
  const isApprover = leaveRequest.approvals.some((a) => a.approver && a.approver._id.toString() === req.employee._id.toString());
  const isManager = leaveRequest.employee.manager && leaveRequest.employee.manager.toString() === req.employee._id.toString();
  const isPrivileged = ['Super Admin', 'Admin', 'HR Manager'].includes(requesterRole);

  if (!isOwner && !isApprover && !isManager && !isPrivileged) {
    throw new ForbiddenError('You do not have access to this leave request.');
  }

  res.status(200).json({ status: 'success', data: { leaveRequest } });
});

exports.approveLeaveRequest = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  const leaveRequest = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName email manager teamLead');

  if (!leaveRequest) throw new NotFoundError('Leave request');
  if (leaveRequest.status !== 'pending') throw new ConflictError('Leave request is not pending.');

  const result = await processApproval(leaveRequest, req.employee, 'approve', comment || '');
  if (result.status === 'error') throw new AppError(result.message, 400);

  await logAudit({
    actor: req.employee._id,
    actorRole: req.employee?.role?.name,
    action: 'approve_leave',
    target: leaveRequest._id,
    targetModel: 'LeaveRequest',
    description: `Leave request ${result.status}: ${leaveRequest.leaveType}`,
    req,
  });

  res.status(200).json({ status: 'success', message: result.message, data: { leaveRequest: result.leaveRequest } });
});

exports.rejectLeaveRequest = asyncHandler(async (req, res) => {
  const { comment } = req.body;
  if (!comment) throw new ValidationError('A comment is required when rejecting a leave request.');

  const leaveRequest = await LeaveRequest.findById(req.params.id)
    .populate('employee', 'firstName lastName email manager teamLead');

  if (!leaveRequest) throw new NotFoundError('Leave request');
  if (leaveRequest.status !== 'pending') throw new ConflictError('Leave request is not pending.');

  const result = await processApproval(leaveRequest, req.employee, 'reject', comment);
  if (result.status === 'error') throw new AppError(result.message, 400);

  await logAudit({
    actor: req.employee._id,
    actorRole: req.employee?.role?.name,
    action: 'reject_leave',
    target: leaveRequest._id,
    targetModel: 'LeaveRequest',
    description: `Leave request rejected: ${leaveRequest.leaveType}`,
    req,
  });

  res.status(200).json({ status: 'success', message: result.message, data: { leaveRequest: result.leaveRequest } });
});

exports.cancelLeaveRequest = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const leaveRequest = await LeaveRequest.findById(req.params.id);

  if (!leaveRequest) throw new NotFoundError('Leave request');

  const isOwner = leaveRequest.employee.toString() === req.employee._id.toString();
  const isPrivileged = ['Super Admin', 'Admin', 'HR Manager'].includes(req.employee?.role?.name);

  if (!isOwner && !isPrivileged) throw new ForbiddenError('Only the owner or HR can cancel a leave request.');
  if (!['pending', 'approved'].includes(leaveRequest.status)) {
    throw new ConflictError('Cannot cancel a request that is already rejected or cancelled.');
  }

  const wasApproved = leaveRequest.status === 'approved';
  leaveRequest.status = 'cancelled';
  leaveRequest.cancelledReason = reason || '';
  leaveRequest.history.push({
    action: 'cancelled',
    by: req.employee._id,
    comment: reason || '',
    at: new Date(),
  });
  await leaveRequest.save();

  await recalculateLeaveBalance(leaveRequest.employee);

  await logAudit({
    actor: req.employee._id,
    actorRole: req.employee?.role?.name,
    action: 'cancel_leave',
    target: leaveRequest._id,
    targetModel: 'LeaveRequest',
    description: `Leave request cancelled: ${leaveRequest.leaveType}`,
    req,
  });

  res.status(200).json({ status: 'success', message: 'Leave request cancelled.' });
});

exports.withdrawLeaveRequest = asyncHandler(async (req, res) => {
  const leaveRequest = await LeaveRequest.findById(req.params.id);
  if (!leaveRequest) throw new NotFoundError('Leave request');

  if (leaveRequest.employee.toString() !== req.employee._id.toString()) {
    throw new ForbiddenError('You can only withdraw your own requests.');
  }
  if (leaveRequest.status !== 'pending') {
    throw new ConflictError('Only pending requests can be withdrawn.');
  }

  leaveRequest.status = 'withdrawn';
  leaveRequest.history.push({
    action: 'withdrawn',
    by: req.employee._id,
    comment: 'Withdrawn by employee',
    at: new Date(),
  });
  await leaveRequest.save();
  await recalculateLeaveBalance(leaveRequest.employee);

  await logAudit({
    actor: req.employee._id,
    actorRole: req.employee?.role?.name,
    action: 'withdraw_leave',
    target: leaveRequest._id,
    targetModel: 'LeaveRequest',
    description: `Leave request withdrawn: ${leaveRequest.leaveType}`,
    req,
  });

  res.status(200).json({ status: 'success', message: 'Leave request withdrawn.' });
});

exports.getMyLeaveRequests = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const filter = { employee: req.employee._id };
  if (status) filter.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [requests, total] = await Promise.all([
    LeaveRequest.find(filter).sort('-createdAt').skip(skip).limit(parseInt(limit)),
    LeaveRequest.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    data: {
      requests,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    },
  });
});

exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = {
    'approvals.approver': req.employee._id,
    status: 'pending',
  };

  const [requests, total] = await Promise.all([
    LeaveRequest.find(filter)
      .populate('employee', 'firstName lastName email employeeId avatar')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit)),
    LeaveRequest.countDocuments(filter),
  ]);

  // Only return requests where this approver is at the current stage
  const mine = requests.filter((r) => {
    const current = r.approvals[r.currentStage];
    return current && current.approver.toString() === req.employee._id.toString() && current.status === 'pending';
  });

  res.status(200).json({
    status: 'success',
    data: {
      requests: mine,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: mine.length },
    },
  });
});

exports.getMyLeaveBalance = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.employee._id).populate('leavePolicy');
  if (!employee) throw new NotFoundError('Employee');

  const recalculated = await recalculateLeaveBalance(employee._id);

  res.status(200).json({
    status: 'success',
    data: {
      leaveBalance: recalculated?.leaveBalance || employee.leaveBalance,
      leavePolicy: employee.leavePolicy,
    },
  });
});
