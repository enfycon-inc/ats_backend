/** Resolve missing name parts without replacing names explicitly entered by recruiters. */
export function resolveCandidateName(
  explicit: { firstName?: string | null; lastName?: string | null },
  parsed: { firstName?: string; lastName?: string; first_name?: string; last_name?: string } | null,
  fullName?: string | null,
) {
  const clean = (value?: string | null) => value?.trim().replace(/\s+/g, ' ') || undefined;
  const reliableName = clean(fullName);
  const parts = reliableName && !/^(unknown|unnamed candidate)$/i.test(reliableName) ? reliableName.split(' ') : [];
  return {
    firstName: clean(explicit.firstName) || clean(parsed?.firstName || parsed?.first_name) || parts[0],
    lastName: clean(explicit.lastName) || clean(parsed?.lastName || parsed?.last_name) || clean(parts.slice(1).join(' ')),
  };
}
