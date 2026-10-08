import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { SubmissionCapabilities } from './tracker-contract';

export function validateTrackerUpdate(existing: Record<string, any>, dto: Record<string, any>, caps: SubmissionCapabilities) {
  const allowed = new Set(['requestId', 'bypassReason', 'expectedUpdatedAt', 'finalStatus', 'remarks', 'reviewFeedback', 'podLeadRemarks', 'recruiterComment', 'submittedRate', 'meetingLink']);
  allowed.add('assessmentVersion'); allowed.add('reviewOverrides');
  for (const round of ['l1', 'l2', 'l3']) for (const suffix of ['Status', 'Date', 'Remarks', 'Interviewer']) allowed.add(`${round}${suffix}`);
  for (const key of Object.keys(dto)) if (!allowed.has(key)) throw new BadRequestException(`Unsupported submission field: ${key}`);
  if (dto.requestId !== undefined && (typeof dto.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.requestId))) throw new BadRequestException('Invalid save request ID.');
  if (dto.bypassReason !== undefined && (typeof dto.bypassReason !== 'string' || dto.bypassReason.length > 4000)) throw new BadRequestException('Invalid bypass reason.');
  const requirePermission = (allowed: boolean) => { if (!allowed) throw new ForbiddenException('You do not have permission to make this submission change.'); };
  if (dto.assessmentVersion !== undefined || dto.reviewOverrides !== undefined) {
    requirePermission(caps.review);
    if (existing.finalStatus !== 'PENDING_APPROVAL' || !['SUBMITTED', 'REJECTED'].includes(dto.finalStatus)) throw new BadRequestException('Assessment snapshots require an internal review decision.');
    if (typeof dto.assessmentVersion !== 'string' || !/^[a-f0-9]{64}$/.test(dto.assessmentVersion)) throw new BadRequestException('Invalid assessment version.');
    if (dto.reviewOverrides !== undefined && (!dto.reviewOverrides || typeof dto.reviewOverrides !== 'object' || Array.isArray(dto.reviewOverrides) || Object.keys(dto.reviewOverrides).length > 200 || Object.entries(dto.reviewOverrides).some(([key, value]) => key.length > 500 || !['Meets', 'Does not meet', 'Needs clarification'].includes(value as string)))) throw new BadRequestException('Invalid reviewer overrides.');
  }
  const terminal = ['REJECTED', 'JOIN'].includes(existing.finalStatus);
  let changedRound = false;
  for (const round of ['l1', 'l2', 'l3'] as const) {
    const touched = ['Status', 'Date', 'Remarks', 'Interviewer'].some(suffix => dto[`${round}${suffix}`] !== undefined);
    if (!touched) continue;
    changedRound = true;
    if (terminal || existing.finalStatus === 'PENDING_APPROVAL') throw new BadRequestException('Interviews require an approved, active submission.');
    const prior = round === 'l2' ? 'l1' : round === 'l3' ? 'l2' : null;
    if (prior && (dto[`${prior}Status`] ?? existing[`${prior}Status`]) !== 'CLEARED') throw new BadRequestException('Clear the previous interview round first.');
    const status = dto[`${round}Status`] ?? existing[`${round}Status`];
    if (dto[`${round}Status`] !== undefined && !['PENDING', 'SCHEDULED', 'CLEARED', 'REJECTED', null].includes(dto[`${round}Status`])) throw new BadRequestException('Invalid interview result.');
    const scheduling = status === 'SCHEDULED';
    if (dto[`${round}Status`] !== undefined) requirePermission(scheduling ? caps.schedule || caps.results[round] : caps.results[round]);
    const recordingResult = dto[`${round}Status`] === 'CLEARED' && dto[`${round}Status`] !== existing[`${round}Status`];
    if (recordingResult && (existing.finalStatus !== 'SUBMITTED' || existing[`${round}Status`] !== 'SCHEDULED' || !existing[`${round}Date`] || !Number.isFinite(new Date(existing[`${round}Date`]).getTime()))) {
      throw new BadRequestException('Schedule this interview before recording its result.');
    }
    if (dto[`${round}Status`] === 'REJECTED' && existing[`${round}Status`] !== 'REJECTED') {
      const activeRound = ['l1', 'l2', 'l3'].find(key => existing[`${key}Status`] !== 'CLEARED');
      if (existing.finalStatus !== 'SUBMITTED' || activeRound !== round || ![null, undefined, 'PENDING', 'SCHEDULED'].includes(existing[`${round}Status`])) throw new BadRequestException('Only the current active round can be rejected.');
      if (typeof dto[`${round}Remarks`] !== 'string' || !dto[`${round}Remarks`].trim()) throw new BadRequestException('Add remarks for the stage rejection.');
    }
    if (dto[`${round}Date`] !== undefined || dto[`${round}Interviewer`] !== undefined) requirePermission(caps.schedule || caps.results[round]);
    if (dto[`${round}Remarks`] !== undefined) requirePermission(caps.results[round] || (scheduling && caps.schedule));
    const date = dto[`${round}Date`] !== undefined ? dto[`${round}Date`] : existing[`${round}Date`];
    if (date && !Number.isFinite(new Date(date).getTime())) throw new BadRequestException('Invalid interview date.');
    if (scheduling && !date) throw new BadRequestException('Choose an interview date and time.');
  }
  if (dto.meetingLink !== undefined) {
    requirePermission(caps.schedule || Object.values(caps.results).some(Boolean));
    if (dto.meetingLink) {
      try { if (!['https:', 'http:'].includes(new URL(dto.meetingLink).protocol)) throw new Error(); }
      catch { throw new BadRequestException('Enter a valid HTTP or HTTPS meeting link.'); }
    }
  }
  if (dto.reviewFeedback !== undefined || dto.podLeadRemarks !== undefined) requirePermission(caps.review);
  if (dto.recruiterComment !== undefined) requirePermission(caps.notes);
  if (dto.submittedRate !== undefined) {
    requirePermission(caps.rate);
    if (!/^\d+(\.\d{1,2})?$/.test(String(dto.submittedRate)) || Number(dto.submittedRate) > 99999999.99) throw new BadRequestException('Enter a valid non-negative rate with at most two decimals.');
  }
  if (dto.finalStatus !== undefined) {
    if (!['PENDING_APPROVAL', 'SUBMITTED', 'REJECTED', 'OFFER', 'JOIN'].includes(dto.finalStatus)) throw new BadRequestException('Invalid submission outcome.');
    const derivedRejection = dto.finalStatus === 'REJECTED' && ['l1', 'l2', 'l3'].some(round => dto[`${round}Status`] === 'REJECTED');
    if (!derivedRejection) {
      requirePermission(existing.finalStatus === 'PENDING_APPROVAL' ? caps.review : caps.outcome);
      if (existing.finalStatus === 'PENDING_APPROVAL' && !['SUBMITTED', 'REJECTED'].includes(dto.finalStatus)) throw new BadRequestException('Approve or reject internal review first.');
      if (existing.finalStatus !== 'PENDING_APPROVAL' && ['SUBMITTED', 'PENDING_APPROVAL'].includes(dto.finalStatus) && dto.finalStatus !== existing.finalStatus) throw new BadRequestException('This action cannot reopen a submission.');
      if (terminal && dto.finalStatus !== existing.finalStatus) throw new BadRequestException('This submission is closed.');
      const bypass = dto.finalStatus !== existing.finalStatus && (
        (dto.finalStatus === 'OFFER' && (dto.l3Status ?? existing.l3Status) !== 'CLEARED') ||
        (dto.finalStatus === 'JOIN' && (existing.finalStatus !== 'OFFER' || existing.l3Status !== 'CLEARED')));
      if (bypass && (typeof dto.bypassReason !== 'string' || !dto.bypassReason.trim())) throw new BadRequestException('Record a reason for bypassing the normal hiring sequence.');
    }
  }
  if (dto.remarks !== undefined) requirePermission(caps.notes || (dto.finalStatus !== undefined && (caps.review || caps.outcome)));
  if (dto.expectedUpdatedAt !== undefined && !Number.isFinite(new Date(dto.expectedUpdatedAt).getTime())) throw new BadRequestException('Invalid submission version.');
  if (!changedRound && Object.keys(dto).every(key => ['expectedUpdatedAt', 'requestId', 'bypassReason'].includes(key))) throw new BadRequestException('No changes to save.');
}
