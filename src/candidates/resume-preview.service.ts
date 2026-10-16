import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StoredResumeFile } from './candidates.service';

@Injectable()
export class ResumePreviewService {
  private cache = new Map<string, { expires: number; value: Buffer | { pages: number }; bytes: number }>();
  private pending = new Map<string, Promise<Buffer | { pages: number }>>();
  private bytes = 0;
  async render(file: StoredResumeFile, tenantId: string, page: number): Promise<Buffer | { pages: number }> {
    if (!Number.isInteger(page) || page < 0 || page > 30 || file.data.length > 10 * 1024**2) throw new BadRequestException('Invalid resume page or file size.');
    const host = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
    if (!host) throw new ServiceUnavailableException('Resume rendering is not configured.');
    const key = `${tenantId}:${createHash('sha256').update(file.data).digest('hex')}:v1:${page}`;
    for (const [id, item] of this.cache) if (item.expires < Date.now()) { this.cache.delete(id); this.bytes -= item.bytes; }
    const cached = this.cache.get(key);
    if (cached) return cached.value;
    const active = this.pending.get(key);
    if (active) return active;
    if (this.pending.size >= 4) throw new ServiceUnavailableException('Resume viewer is busy. Please retry.');
    const operation = this.convert(file, page).then(value => {
      const bytes = Buffer.isBuffer(value) ? value.length : 64;
      while (this.bytes + bytes > 32 * 1024**2 && this.cache.size) {
        const oldest = this.cache.keys().next().value!;
        this.bytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      this.cache.set(key, { value, bytes, expires: Date.now() + 5 * 60 * 1000 }); this.bytes += bytes;
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }
  private async convert(file: StoredResumeFile, page: number) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.filename);
    form.append('page', String(page));
    try {
      const host = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
      const response = await fetch(`${host.replace(/\/$/, '')}/api/v1/resume-preview`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('render');
      if (page) {
        if (!response.headers.get('content-type')?.startsWith('image/png')) throw new Error('format');
        const image = Buffer.from(await response.arrayBuffer());
        if (image.length > 10 * 1024**2 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('format');
        return image;
      }
      const result = await response.json() as { pages: number };
      if (!Number.isInteger(result.pages) || result.pages < 1 || result.pages > 30) throw new Error('pages');
      return { pages: result.pages };
    } catch { throw new ServiceUnavailableException('Resume cannot be displayed. Please retry or contact your administrator.'); }
  }
}
