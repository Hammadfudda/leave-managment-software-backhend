import { AsyncLocalStorage } from 'node:async_hooks';

const tenantStorage = new AsyncLocalStorage();

/**
 * organizationId values:
 * - ObjectId/string => SaaS client organization
 * - null            => legacy/demo tenant
 * - undefined       => no tenant context (public auth / Super Admin)
 */
export function runWithTenant(organizationId, callback) {
  const normalized =
    organizationId === null || organizationId === undefined
      ? null
      : String(organizationId);

  return tenantStorage.run(
    {
      active: true,
      organizationId: normalized,
    },
    callback
  );
}

export function getTenantOrganizationId() {
  const store = tenantStorage.getStore();

  if (!store?.active) {
    return undefined;
  }

  return store.organizationId;
}
