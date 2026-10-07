import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { SubmissionCapabilities } from './tracker-contract';

export function validateTrackerUpdate(existing: Record<string, any>, dto: Record<string, any>, caps: SubmissionCapabilities) {
  const allowed = new Set(['expectedUpdatedAt', 'finalStatus', 'remarks', 'reviewFeedback', 'podLeadRemarks', 'recruiterComment', 'submittedRate', 'meetingLink']);
  for (const round of ['l1', 'l2', 'l3']) for (const suffix of ['Status', 'Date', 'Remarks', 'Interviewer']) allowed.add(`${round}${suffix}`);
  for (const key of Object.keys(dto)) if (!allowed.has(key)) throw new BadRequestException(`Unsupported submission field: ${key}`);
  const requirePermission = (allowed: boolean) => { if (!allowed) throw new ForbiddenException('You do not have permission to make this submission change.'); };
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
      if (dto.finalStatus === 'OFFER' && (dto.l3Status ?? existing.l3Status) !== 'CLEARED') throw new BadRequestException('Clear the final interview round before issuing an offer.');
      if (dto.finalStatus === 'JOIN' && existing.finalStatus !== 'OFFER' && existing.finalStatus !== 'JOIN') throw new BadRequestException('Record the offer before confirming joining.');
    }
  }
  if (dto.remarks !== undefined) requirePermission(caps.notes || (dto.finalStatus !== undefined && (caps.review || caps.outcome)));
  if (dto.expectedUpdatedAt !== undefined && !Number.isFinite(new Date(dto.expectedUpdatedAt).getTime())) throw new BadRequestException('Invalid submission version.');
  if (!changedRound && Object.keys(dto).every(key => key === 'expectedUpdatedAt')) throw new BadRequestException('No changes to save.');
}
