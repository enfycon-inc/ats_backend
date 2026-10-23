import { sanitizeJobDescription } from './job-description-html';
import { normalizeJobTitle } from './job-description-policy';

describe('job description persistence safety', () => {
  it('preserves safe formatting while removing active content and unsafe styles', () => {
    const html = sanitizeJobDescription('<h2>Skills</h2><p class="ql-align-center evil" style="color:red;background-image:url(javascript:alert(1))" onclick="alert(1)"><strong>C# / .NET</strong><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">Bad</a><a href="https://example.com">Good</a></p>');
    expect(html).toContain('<h2>Skills</h2>');
    expect(html).toContain('<strong>C# / .NET</strong>');
    expect(html).toContain('ql-align-center');
    expect(html).toContain('color:red');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toMatch(/javascript|onclick|onerror|background-image|<script|<img|evil|alert/);
    expect(sanitizeJobDescription(html)).toBe(html);
  });
  it('normalizes Markdown titles without removing technical characters', () => {
    expect(normalizeJobTitle('# **Job Title:** C# / .NET Developer')).toBe('C# / .NET Developer');
  });
});
