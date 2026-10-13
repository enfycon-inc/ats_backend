import sanitizeHtml from 'sanitize-html';

// Only email-safe formatting survives paste. No scripts, SVG, CSS URLs, or embedded documents.
export function sanitizeSignature(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'img', 'ul', 'ol', 'li', 'table', 'tbody', 'tr', 'td'],
    allowedAttributes: {
      '*': ['style'], a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'],
      table: ['cellpadding', 'cellspacing', 'border', 'width'], td: ['width', 'valign'],
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i],
        'font-family': [/^(Arial|Calibri|Segoe UI|Tahoma|Verdana|Georgia|sans-serif|serif)(,\s*(sans-serif|serif))?$/i],
        'font-size': [/^(?:[8-9]|[12]\d|3[0-2])(?:px|pt)$/],
        'font-weight': [/^(normal|bold|[4-7]00)$/],
        'font-style': [/^(normal|italic)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
        'text-align': [/^(left|center|right)$/],
        'line-height': [/^(1(?:\.\d)?|2)$/],
        margin: [/^0(?:px)?$/], padding: [/^\d{1,2}px$/],
        width: [/^\d{1,3}px$/], height: [/^\d{1,3}px$/],
      },
    },
    transformTags: {
      // Quill uses CSS classes; convert its small supported set to portable inline styles.
      '*': (tagName, attributes) => {
        const styles = [attributes.style || ''];
        for (const value of (attributes.class || '').split(/\s+/)) {
          if (value === 'ql-size-small') styles.push('font-size:10px');
          if (value === 'ql-size-large') styles.push('font-size:18px');
          if (value === 'ql-size-huge') styles.push('font-size:24px');
          if (value === 'ql-font-serif') styles.push('font-family:Georgia, serif');
          if (/^ql-align-(center|right)$/.test(value)) styles.push(`text-align:${value.slice(9)}`);
        }
        return { tagName, attribs: { ...attributes, style: styles.filter(Boolean).join(';') } };
      },
    },
  });
}
