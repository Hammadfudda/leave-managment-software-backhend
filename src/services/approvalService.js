const LeaveRequest = require('../models/LeaveRequest');
const Employee = require('../models/Employee');
const { recalculateLeaveBalance } = require('../utils/leaveBalance');
const { createNotification } = require('./notificationService');

/**
 * Apply an approval action (approve / reject) to a leave request.
 * Handles multi-stage forwarding, balance updates, and notifications.
 *
 * @param {Object} leaveRequest - Mongoose document
 * @param {Object} approverEmployee - the employee acting on the request
 * @param {String} action - 'approve' | 'reject'
 * @param {String} comment
 * @returns {Object} { status, message, leaveRequest }
 */
async function processApproval(leaveRequest, approverEmployee, action, comment = '') {
  const approvals = leaveRequest.approvals || [];
  const currentIdx = leaveRequest.currentStage;

  if (currentIdx >= approvals.length) {
    return { status: 'error', message: 'No pending approval stage.' };
  }

  const currentApproval = approvals[currentIdx];

  if (currentApproval.status !== 'pending') {
    return { status: 'error', message: 'Current stage is not pending.' };
  }

  // Verify approver is the one assigned to this stage
  if (currentApproval.approver.toString() !== approverEmployee._id.toString()) {
    return { status: 'error', message: 'You are not the assigned approver for this stage.' };
  }

  if (action === 'reject') {
    currentApproval.status = 'rejected';
    currentApproval.comment = comment;
    currentApproval.actedAt = new Date();

    leaveRequest.status = 'rejected';
    leaveRequest.rejectedBy = approverEmployee._id;
    leaveRequest.approverComment = comment;

    leaveRequest.history.push({
      action: 'rejected',
      by: approverEmployee._id,
      comment,
      at: new Date(),
    });

    await leaveRequest.save();
    await recalculateLeaveBalance(leaveRequest.employee);

    const employee = await Employee.findById(leaveRequest.employee);
    if (employee) {
      await createNotification({
        recipient: employee._id,
        type: 'leave_rejected',
        title: 'Leave request rejected',
        message: `Your ${leaveRequest.leaveType} leave request was rejected by ${approverEmployee.firstName} ${approverEmployee.lastName}.`,
        relatedLeave: leaveRequest._id,
        channel: 'both',
        recipientEmail: employee.email,
        recipientName: `${employee.firstName} ${employee.lastName}`,
        leaveDetails: {
          leaveType: leaveRequest.leaveType,
          startDate: leaveRequest.startDate.toISOString().split('T')[0],
          endDate: leaveRequest.endDate.toISOString().split('T')[0],
          totalDays: leaveRequest.totalDays,
          reason: leaveRequest.reason,
        },
        comment,
      });
    }

    return { status: 'rejected', message: 'Leave request rejected.', leaveRequest };
  }

  // Approve current stage
  currentApproval.status = 'approved';
  currentApproval.comment = comment;
  currentApproval.actedAt = new Date();

  leaveRequest.history.push({
    action: 'approved',
    by: approverEmployee._id,
    comment,
    at: new Date(),
  });

  const nextIdx = currentIdx + 1;

  // Check if there's a next pending stage
  if (nextIdx < approvals.length) {
    leaveRequest.currentStage = nextIdx;
    leaveRequest.history.push({
      action: 'forwarded',
      by: approverEmployee._id,
      comment: 'Forwarded to next approver',
      at: new Date(),
    });

    await leaveRequest.save();

    const nextApproverId = approvals[nextIdx].approver;
    const nextApprover = await Employee.findById(nextApproverId);
    if (nextApprover) {
      const requester = await Employee.findById(leaveRequest.employee);
      await createNotification({
        recipient: nextApprover._id,
        type: 'approval_pending',
        title: 'Leave request pending your approval',
        message: `Leave request from ${requester?.firstName || ''} ${requester?.lastName || ''} is pending your approval.`,
        relatedLeave: leaveRequest._id,
        channel: 'both',
        recipientEmail: nextApprover.email,
        recipientName: `${nextApprover.firstName} ${nextApprover.lastName}`,
        leaveDetails: {
          leaveType: leaveRequest.leaveType,
          startDate: leaveRequest.startDate.toISOString().split('T')[0],
          endDate: leaveRequest.endDate.toISOString().split('T')[0],
          totalDays: leaveRequest.totalDays,
          reason: leaveRequest.reason,
        },
      });
    }

    return { status: 'forwarded', message: 'Approved and forwarded to next approver.', leaveRequest };
  }

  // Final approval
  leaveRequest.status = 'approved';
  leaveRequest.approvedBy = approverEmployee._id;
  leaveRequest.approverComment = comment;

  await leaveRequest.save();
  await recalculateLeaveBalance(leaveRequest.employee);

  const employee = await Employee.findById(leaveRequest.employee);
  if (employee) {
    await createNotification({
      recipient: employee._id,
      type: 'leave_approved',
      title: 'Leave request approved',
      message: `Your ${leaveRequest.leaveType} leave request has been approved.`,
      relatedLeave: leaveRequest._id,
      channel: 'both',
      recipientEmail: employee.email,
      recipientName: `${employee.firstName} ${employee.lastName}`,
      leaveDetails: {
        leaveType: leaveRequest.leaveType,
        startDate: leaveRequest.startDate.toISOString().split('T')[0],
        endDate: leaveRequest.endDate.toISOString().split('T')[0],
        totalDays: leaveRequest.totalDays,
        reason: leaveRequest.reason,
      },
      comment,
    });
  }

  return { status: 'approved', message: 'Leave request fully approved.', leaveRequest };
}

module.exports = { processApproval };
