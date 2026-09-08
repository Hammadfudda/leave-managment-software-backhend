/**
 * Build the approval chain for a leave request based on employee's reporting hierarchy.
 * Order: Team Lead -> Manager -> HR Manager (skips any that are null).
 */
async function buildApprovalChain(employee) {
  const approvals = [];
  let order = 0;

  const stages = [
    { ref: employee.teamLead, role: 'Team Lead' },
    { ref: employee.manager, role: 'Manager' },
  ];

  for (const stage of stages) {
    if (stage.ref) {
      approvals.push({
        approver: stage.ref,
        approverRole: stage.role,
        status: 'pending',
        order: order++,
      });
    }
  }

  // HR Manager is always the final approver if defined
  // (resolved dynamically by the controller when acting on the request)
  return approvals;
}

module.exports = { buildApprovalChain };
