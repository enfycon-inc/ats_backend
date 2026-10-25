/** Effective feature policy. Saved unit preferences never override a disabled tenant. */
export function effectiveJobAssignmentPolicy<T extends { allowPods?: boolean; allowNone?: boolean }>(policy: T | null | undefined, tenantPodsEnabled: boolean): (T & { allowPods: boolean; allowNone: boolean | undefined }) | null {
  if (!policy) return null;
  const podsEnabled = tenantPodsEnabled === true && policy.allowPods === true;
  return { ...policy, allowPods: podsEnabled, allowNone: podsEnabled ? policy.allowNone : true };
}
