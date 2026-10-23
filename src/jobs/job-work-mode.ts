export type JobWorkMode = 'In Office' | 'Remote' | 'Hybrid';

/** Canonical work modes plus supported legacy form/parser aliases. */
export function normalizeJobWorkMode(value: unknown): JobWorkMode | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase().replace(/[\s_-]+/g, '')) {
    case 'inoffice': case 'office': case 'onsite': case 'no': return 'In Office';
    case 'remote': case 'yes': return 'Remote';
    case 'hybrid': return 'Hybrid';
    default: return undefined;
  }
}
