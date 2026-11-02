import { BadRequestException } from '@nestjs/common';

export function linkedinProfile(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Enter a valid LinkedIn profile URL.');
  const text = value.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (text.length > 500 || url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || url.username || url.password || url.port || !/^\/in\/[^/]+\/?$/.test(url.pathname)) throw new Error();
    url.search = ''; url.hash = '';
    return url.toString();
  } catch { throw new BadRequestException('Enter a valid HTTPS LinkedIn profile URL.'); }
}
