import { sanitizeSignature } from './signature-html';

describe('Email signature HTML boundary', () => {
  it('removes executable HTML, unsafe links, embedded data and CSS URLs', () => {
    const html = sanitizeSignature('<script>alert(1)</script><svg onload="alert(1)"></svg><a href="javascript:alert(1)">Name</a><img src="data:image/svg+xml;base64,AAAA" onerror="alert(1)"><p style="background-image:url(https://evil.example);color:#1a4fa0" onclick="alert(1)">Hello</p>');
    expect(html).not.toMatch(/script|svg|onerror|onclick|javascript:|data:|background-image/);
    expect(html).toContain('color:#1a4fa0');
    expect(html).toContain('Hello');
  });
  it('preserves supported formatting, HTTPS logos and contact links', () => {
    const html = sanitizeSignature('<p class="ql-align-right ql-size-large"><strong>Member</strong></p><a href="mailto:member@example.com">Email</a><img src="https://example.com/logo.png" width="160" alt="Company">');
    expect(html).toContain('text-align:right');
    expect(html).toContain('font-size:18px');
    expect(html).toContain('<strong>Member</strong>');
    expect(html).toContain('mailto:member@example.com');
    expect(html).toContain('https://example.com/logo.png');
    expect(html).not.toContain('class=');
  });
});
