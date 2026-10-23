// Shared with the frontend by scripts/sync-job-description-policy.cjs.
// Keep this module browser-safe: formatting policy must not depend on Node APIs.
export const JOB_DESCRIPTION_TAGS = [
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'a', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sub', 'sup',
];
export const JOB_DESCRIPTION_ATTRIBUTES = ['class', 'style', 'href', 'title', 'data-list', 'data-language', 'colspan', 'rowspan', 'start'];

export function jobDescriptionClasses(value: string): string {
  return value.split(/\s+/).filter(name => /^(?:ql-(?:align-(?:left|center|right|justify)|direction-rtl|indent-[1-8]|size-(?:small|large|huge)|font-(?:serif|monospace)|code-block(?:-container)?|ui)|language-[\w-]+)$/.test(name)).join(' ');
}

export function jobDescriptionStyle(value: string): string {
  const color = /^(?:#[\da-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\)|black|white|red|blue|green|yellow|orange|purple|gray|grey|transparent|inherit)$/i;
  const allowed: Record<string, RegExp> = {
    color, 'background-color': color,
    'text-align': /^(left|center|right|justify)$/i,
    'font-weight': /^(normal|bold|[4-9]00)$/i,
    'font-style': /^(normal|italic)$/i,
    'text-decoration': /^(none|underline|line-through)$/i,
  };
  return value.split(';').flatMap(declaration => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return [];
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const content = declaration.slice(separator + 1).trim();
    return allowed[property]?.test(content) ? [`${property}:${content}`] : [];
  }).join(';');
}

export function safeJobDescriptionHref(value: string): boolean {
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href) || href.startsWith('//')) return false;
  return /^(https?:|mailto:|tel:)/i.test(href) || !/^[a-z][a-z\d+.-]*:/i.test(href);
}

export function stripJobTitleMarkdown(value: string): string {
  return value.trim().replace(/^\uFEFF/, '')
    .replace(/^ {0,3}(?:#{1,6}\s+|[-*+]\s+)/, '')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_match, bold: string | undefined, underscored: string | undefined) => bold ?? underscored ?? '')
    .trim();
}

export function normalizeJobTitle(value?: string | null): string {
  const title = stripJobTitleMarkdown(typeof value === 'string' ? value : '').replace(/^(?:job title|role|position|title)\s*[:：]\s*/i, '').trim();
  return /^unknown$/i.test(title) ? '' : title;
}
