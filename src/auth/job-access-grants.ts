/** Canonical grants for the versioned job-access policy; roles remain permission bundles. */
export function jobAccessGrants(permissions: readonly string[]): string[] {
  const has = (key: string) => permissions.includes(key);
  const grants: string[] = [];
  if (has('job:view') && has('candidate:view') && has('submission:create')) grants.push('job:find_matches_assigned');
  if (has('tenant:settings') || has('tenant:manage')) grants.push('job:manage_publication_tenant');
  else if (has('branch_admin:manage')) grants.push('job:manage_publication_branch');
  else if (has('unit_admin:manage')) grants.push('job:manage_publication_unit');
  return grants;
}
