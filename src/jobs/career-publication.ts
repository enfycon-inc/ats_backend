import { randomUUID } from 'node:crypto';

// New jobs are enrolled in the careers feed at creation. Feed eligibility still
// requires approval and an allowed operational status. Edits never reset this flag.
export function careerPublicationDefaults(title: string, code: string) {
  const slug = `${title || 'job'}-${code || ''}`.normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 130);
  return { isPubliclyPublished: true, publicSlug: `${slug}-${randomUUID()}` };
}
