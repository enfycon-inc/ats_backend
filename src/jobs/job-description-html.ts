import sanitizeHtml from 'sanitize-html';
import { JOB_DESCRIPTION_TAGS, JOB_DESCRIPTION_ATTRIBUTES, jobDescriptionClasses, jobDescriptionStyle, safeJobDescriptionHref } from './job-description-policy';

export function sanitizeJobDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: JOB_DESCRIPTION_TAGS,
    allowedAttributes: Object.fromEntries(JOB_DESCRIPTION_TAGS.map(tag => [tag, JOB_DESCRIPTION_ATTRIBUTES])),
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    // Style declarations are filtered by our small shared policy, including in
    // browser previews; do not allow an independent CSS parser to widen it.
    parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'xmp', 'noscript', 'iframe', 'object', 'svg', 'math'],
    transformTags: {
      '*': (tagName, attributes) => {
        const attribs = { ...attributes };
        if (attribs.class) attribs.class = jobDescriptionClasses(attribs.class);
        if (attribs.style) attribs.style = jobDescriptionStyle(attribs.style);
        if (attribs.href && !safeJobDescriptionHref(attribs.href)) delete attribs.href;
        return { tagName, attribs };
      },
    },
  });
}
