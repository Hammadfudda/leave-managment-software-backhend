import User from '../models/User.js';
import Grade from '../models/Grade.js';
import Department from '../models/Department.js';
import Designation from '../models/Designation.js';
import RoleLabel from '../models/RoleLabel.js';
import LeavePolicy from '../models/LeavePolicy.js';

async function assignWhenSingleOrganization(Model, doc, organizationIds) {
  const ids = organizationIds.filter(Boolean).map(String);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 1) {
    doc.organizationId = uniqueIds[0];
    await doc.save();
    return true;
  }
  return false;
}

/**
 * Legacy records were created before organization ownership existed.
 * Automatically claim records that can be unambiguously tied to one tenant.
 * Ambiguous records remain shared/read-only, which is safer than guessing.
 */
export async function migrateLegacyTenantOwnership() {
  const legacyGrades = await Grade.find({ organizationId: null });
  for (const grade of legacyGrades) {
    const orgIds = await User.find({ gradeId: grade._id }).distinct('organizationId');
    await assignWhenSingleOrganization(Grade, grade, orgIds);
  }

  const legacyDepartments = await Department.find({ organizationId: null });
  for (const department of legacyDepartments) {
    const orgIds = await User.find({ department: department.name }).distinct('organizationId');
    await assignWhenSingleOrganization(Department, department, orgIds);
  }

  const legacyDesignations = await Designation.find({ organizationId: null });
  for (const designation of legacyDesignations) {
    const orgIds = await User.find({ designation: designation.name }).distinct('organizationId');
    await assignWhenSingleOrganization(Designation, designation, orgIds);
  }

  const legacyRoles = await RoleLabel.find({ organizationId: null });
  for (const roleLabel of legacyRoles) {
    const orgIds = await User.find({ roleLabel: roleLabel.name }).distinct('organizationId');
    await assignWhenSingleOrganization(RoleLabel, roleLabel, orgIds);
  }

  const legacyPolicies = await LeavePolicy.find({ organizationId: null });
  for (const policy of legacyPolicies) {
    let orgIds = [];

    if (policy.approvalRouting?.approverIds?.length) {
      orgIds = await User.find({
        _id: { $in: policy.approvalRouting.approverIds },
      }).distinct('organizationId');
    }

    if (!orgIds.filter(Boolean).length) {
      const userFilter = {};
      if (policy.approvalRouting?.department) userFilter.department = policy.approvalRouting.department;
      if (policy.approvalRouting?.designation) userFilter.designation = policy.approvalRouting.designation;
      if (policy.approvalRouting?.grade) userFilter.gradeId = policy.approvalRouting.grade;
      if (Object.keys(userFilter).length) {
        orgIds = await User.find(userFilter).distinct('organizationId');
      }
    }

    await assignWhenSingleOrganization(LeavePolicy, policy, orgIds);
  }
}
