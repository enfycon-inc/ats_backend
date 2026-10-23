import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RecruiterSubmissionsService } from './recruiter-submissions.service';
import { RecruiterSubmissionsController } from './recruiter-submissions.controller';
import { canDownloadSubmissionResume } from './submission-resume';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

const user = { dbId: 'manager', tenantId: 'tenant', branchId: 'branch', permissions: ['submission:view', 'submission:download_resume'] } as AuthUser;
function setup() {
  const prisma = { candidate: { findFirst: jest.fn() } };
  const service = new RecruiterSubmissionsService(prisma as any, {} as any);
  const visible = jest.spyOn(service, 'findOne').mockResolvedValue({ candidateId: 'candidate', finalStatus: 'SUBMITTED' } as any);
  return { prisma, service, visible };
}

describe('submission-scoped resume download', () => {
  it('requires an explicit capability and an approved viable submission', () => {
    for (const finalStatus of ['SUBMITTED', 'SELECTED', 'OFFER', 'JOIN']) {
      expect(canDownloadSubmissionResume({ finalStatus }, user.permissions)).toBe(true);
      expect(canDownloadSubmissionResume({ finalStatus }, ['candidate:view'])).toBe(false);
    }
    for (const finalStatus of ['PENDING_APPROVAL', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN']) {
      expect(canDownloadSubmissionResume({ finalStatus }, user.permissions)).toBe(false);
    }
  });
  it('does not read visibility or file data without permission', async () => {
    const { service, prisma, visible } = setup();
    await expect(service.resume('submission', 'tenant', { ...user, permissions: ['submission:view'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(visible).not.toHaveBeenCalled();
    expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
  });
  it('includes download eligibility in the existing page response without reading file bytes', async () => {
    const prisma = { $queryRawUnsafe: jest.fn()
      .mockResolvedValueOnce([{ count: 3n }])
      .mockResolvedValueOnce([
        { id: 'approved', final_status: 'SUBMITTED', resume_available: true, resume_filename: 'CV.docx' },
        { id: 'pending', final_status: 'PENDING_APPROVAL', resume_available: true, resume_filename: 'CV.docx' },
        { id: 'missing', final_status: 'SUBMITTED', resume_available: false },
      ]).mockResolvedValueOnce([]) };
    const service = new RecruiterSubmissionsService(prisma as any, {} as any);
    const result = await service.findAll('tenant', user, {});
    expect(result.data.map(submission => submission.resume)).toEqual([
      { available: true, filename: 'CV.docx', canDownload: true },
      { available: true, filename: 'CV.docx', canDownload: false },
      { available: false, filename: null, canDownload: false },
    ]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('fileData');
  });
  it('enforces workspace visibility before reading a resume, including other-tenant IDs', async () => {
    const { service, prisma, visible } = setup();
    visible.mockRejectedValue(new NotFoundException('Submission not found in your accessible workspace.'));
    await expect(service.resume('foreign-submission', 'tenant', user, 'branch')).rejects.toBeInstanceOf(NotFoundException);
    expect(visible).toHaveBeenCalledWith('foreign-submission', 'tenant', user, 'branch');
    expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
  });
  it('rechecks approval on the server and rejects stale download actions', async () => {
    const { service, prisma, visible } = setup();
    visible.mockResolvedValue({ candidateId: 'candidate', finalStatus: 'PENDING_APPROVAL' } as any);
    await expect(service.resume('submission', 'tenant', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.candidate.findFirst).not.toHaveBeenCalled();
  });
  it('reads only the visible tenant candidate file and preserves DOCX data and name', async () => {
    const { service, prisma } = setup();
    const fileData = Buffer.from('original document');
    prisma.candidate.findFirst.mockResolvedValue({ resumeRecord: { fileData, filename: 'CV.docx', fileMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
    const file = await service.resume('submission', 'tenant', user, 'branch');
    expect(prisma.candidate.findFirst).toHaveBeenCalledWith({ where: { id: 'candidate', tenantId: 'tenant', deletedAt: null, submissions: { some: { id: 'submission', tenantId: 'tenant', finalStatus: { in: ['SUBMITTED', 'SELECTED', 'OFFER', 'JOIN'] } } } }, select: { resumeRecord: { select: { fileData: true, fileMime: true, filename: true } } } });
    expect(file.data).toEqual(fileData); expect(file.filename).toBe('CV.docx');
    expect(file.mime).toContain('wordprocessingml');
  });
  it.each([null, { resumeRecord: null }, { resumeRecord: { fileData: null } }])('handles a missing or deleted resume (%p)', async candidate => {
    const { service, prisma } = setup();
    prisma.candidate.findFirst.mockResolvedValue(candidate);
    await expect(service.resume('submission', 'tenant', user)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('streams an attachment with private caching and MIME protection', async () => {
    const service = { resume: jest.fn().mockResolvedValue({ data: Buffer.from('cv'), mime: 'application/pdf', filename: 'CV.pdf' }) };
    const controller = new RecruiterSubmissionsController(service as any);
    const response = { setHeader: jest.fn(), attachment: jest.fn(), send: jest.fn() };
    await controller.resume('submission', user, response as any);
    expect(service.resume).toHaveBeenCalledWith('submission', 'tenant', user, 'branch');
    expect(response.attachment).toHaveBeenCalledWith('CV.pdf');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.send).toHaveBeenCalledWith(Buffer.from('cv'));
  });
});
