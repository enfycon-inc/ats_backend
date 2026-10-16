import { CandidatesController } from './candidates.controller';
import { ResumePreviewService } from './resume-preview.service';

describe('resume access separation', () => {
  const response = () => ({ setHeader: jest.fn(), send: jest.fn(), json: jest.fn(), type: jest.fn().mockReturnThis() }) as any;
  const files: any = { getResumeFile: jest.fn().mockResolvedValue({ data: Buffer.from('pdf'), mime: 'application/pdf', filename: 'cv.pdf' }) };
  const renderer: any = { render: jest.fn().mockResolvedValue({ pages: 2 }) };
  const controller = new CandidatesController(files, {} as any, {} as any, renderer);
  beforeEach(() => jest.clearAllMocks());
  it('rejects original download without exact capability before reading file', async () => {
    await expect(controller.downloadResume('candidate', response(), { permissions: ['candidate:view'], tenantId: 'tenant' } as any)).rejects.toThrow('download permission');
    expect(files.getResumeFile).not.toHaveBeenCalled();
  });
  it('allows scoped viewing without granting original download', async () => {
    const res = response();
    await controller.previewResume('candidate', undefined, res, { permissions: ['candidate:view'], tenantId: 'tenant' } as any);
    expect(files.getResumeFile).toHaveBeenCalledWith('candidate', 'tenant');
    expect(renderer.render).toHaveBeenCalledWith(expect.anything(), 'tenant', 0);
    expect(res.json).toHaveBeenCalledWith({ pages: 2 });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('rejects preview when candidate viewing is unavailable', async () => {
    await expect(controller.previewResume('candidate', '1', response(), { permissions: ['candidate:download_resume'], tenantId: 'tenant' } as any)).rejects.toThrow('view permission');
    expect(renderer.render).not.toHaveBeenCalled();
  });
  it('retains original-download access only when explicitly granted', async () => {
    await controller.downloadResume('candidate', response(), { permissions: ['candidate:download_resume'], tenantId: 'tenant' } as any);
    expect(files.getResumeFile).toHaveBeenCalledWith('candidate', 'tenant');
  });
});
describe('bounded rendering', () => {
  it('caches by tenant and content version while collapsing concurrent requests', async () => {
    const old = process.env.PYTHON_PARSER_URL;
    process.env.PYTHON_PARSER_URL = 'http://renderer.internal';
    const service = new ResumePreviewService();
    const convert = jest.spyOn(service as any, 'convert').mockResolvedValue({ pages: 1 });
    const file = { data: Buffer.from('one'), mime: 'application/pdf', filename: 'cv.pdf' };
    try {
      await Promise.all([service.render(file, 'a', 0), service.render(file, 'a', 0)]);
      expect(convert).toHaveBeenCalledTimes(1);
      await service.render(file, 'b', 0);
      await service.render({ ...file, data: Buffer.from('two') }, 'a', 0);
      expect(convert).toHaveBeenCalledTimes(3);
    } finally { if (old === undefined) delete process.env.PYTHON_PARSER_URL; else process.env.PYTHON_PARSER_URL = old; }
  });
  it('rejects invalid pages and oversized files', async () => {
    const service = new ResumePreviewService();
    const file = { data: Buffer.from('x'), mime: 'application/pdf', filename: 'cv.pdf' };
    await expect(service.render(file, 'tenant', -1)).rejects.toThrow('Invalid');
    await expect(service.render(file, 'tenant', 31)).rejects.toThrow('Invalid');
    await expect(service.render({ ...file, data: Buffer.alloc(10 * 1024**2 + 1) }, 'tenant', 0)).rejects.toThrow('Invalid');
  });
});
