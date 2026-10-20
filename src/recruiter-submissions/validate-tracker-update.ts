import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { SubmissionCapabilities } from './tracker-contract';
import { InterviewRoundStatus, SubmissionOutcome } from './tracker-contract';
import { roundUpdate, ROUND_KEYS } from './round-update';
import { historyValue } from './submission-history';

export function validateTrackerUpdate(existing: Record<string, any>, dto: Record<string, any>, caps: SubmissionCapabilities) {
  const allowed = new Set(['requestId', 'bypassReason', 'correctionReason', 'resetFollowingRounds', 'expectedUpdatedAt', 'finalStatus', 'remarks', 'reviewFeedback', 'podLeadRemarks', 'recruiterComment', 'submittedRate', 'meetingLink']);
  allowed.add('assessmentVersion'); allowed.add('reviewOverrides');
  for (const round of ['l1', 'l2', 'l3']) for (const suffix of ['Status', 'Date', 'Remarks', 'Interviewer', 'Color']) allowed.add(`${round}${suffix}`);
  for (const key of Object.keys(dto)) if (!allowed.has(key)) throw new BadRequestException(`Unsupported submission field: ${key}`);
  if (dto.requestId !== undefined && (typeof dto.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dto.requestId))) throw new BadRequestException('Invalid save request ID.');
  if (dto.bypassReason !== undefined && (typeof dto.bypassReason !== 'string' || dto.bypassReason.length > 4000)) throw new BadRequestException('Invalid bypass reason.');
  if (dto.correctionReason !== undefined && (typeof dto.correctionReason !== 'string' || dto.correctionReason.length > 4000)) throw new BadRequestException('Invalid correction reason.');
  if (dto.resetFollowingRounds !== undefined && typeof dto.resetFollowingRounds !== 'boolean') throw new BadRequestException('Invalid reset confirmation.');
  for (const key of ['remarks', 'reviewFeedback', 'podLeadRemarks', 'recruiterComment', 'l1Remarks', 'l2Remarks', 'l3Remarks']) {
    if (dto[key] != null && (typeof dto[key] !== 'string' || dto[key].length > 4000)) throw new BadRequestException('Remarks must be text of at most 4000 characters.');
  }
  for (const round of ROUND_KEYS) {
    if (dto[`${round}Interviewer`] != null && (typeof dto[`${round}Interviewer`] !== 'string' || dto[`${round}Interviewer`].length > 255)) throw new BadRequestException('Invalid interviewer name.');
    if (dto[`${round}Date`] != null && typeof dto[`${round}Date`] !== 'string') throw new BadRequestException('Invalid interview date.');
  }
  const correction = Boolean(dto.correctionReason?.trim());
  const changes = roundUpdate(existing, dto);
  const merged = { ...existing, ...changes };
  if (existing.finalStatus === 'REJECTED' && existing.rejectionFromStatus === 'PENDING_APPROVAL' && dto.finalStatus !== undefined && dto.finalStatus !== 'REJECTED') throw new BadRequestException('An internal-review rejection cannot be reopened through the interview editor.');
  const requirePermission = (allowed: boolean) => { if (!allowed) throw new ForbiddenException('You do not have permission to make this submission change.'); };
  if (dto.assessmentVersion !== undefined || dto.reviewOverrides !== undefined) {
    requirePermission(caps.review);
    if (existing.finalStatus !== 'PENDING_APPROVAL' || !['SUBMITTED', 'REJECTED'].includes(dto.finalStatus)) throw new BadRequestException('Assessment snapshots require an internal review decision.');
    if (typeof dto.assessmentVersion !== 'string' || !/^[a-f0-9]{64}$/.test(dto.assessmentVersion)) throw new BadRequestException('Invalid assessment version.');
    if (dto.reviewOverrides !== undefined && (!dto.reviewOverrides || typeof dto.reviewOverrides !== 'object' || Array.isArray(dto.reviewOverrides) || Object.keys(dto.reviewOverrides).length > 200 || Object.entries(dto.reviewOverrides).some(([key, value]) => key.length > 500 || !['Meets', 'Does not meet', 'Needs clarification'].includes(value as string)))) throw new BadRequestException('Invalid reviewer overrides.');
  }
  const terminal = ['REJECTED', 'JOIN', 'NOT_SELECTED', 'WITHDRAWN'].includes(existing.finalStatus);
  let changedRound = false;
  for (const round of ['l1', 'l2', 'l3'] as const) {
    const touched = ['Status', 'Date', 'Remarks', 'Interviewer', 'Color'].some(suffix => dto[`${round}${suffix}`] !== undefined && historyValue(dto[`${round}${suffix}`]) !== historyValue(existing[`${round}${suffix}`]));
    if (!touched) continue;
    changedRound = true;
    if (['CLEARED', 'REJECTED'].includes(existing[`${round}Status`])) {
      requirePermission(caps.results[round]);
      if (!correction) throw new BadRequestException('Provide a reason to correct a recorded round result.');
    }
    if (existing.finalStatus === 'PENDING_APPROVAL' || (terminal && !(correction && caps.outcome && dto.finalStatus === 'SUBMITTED'))) throw new BadRequestException('Interviews require an approved, active submission. Reopen with a correction reason first.');
    const prior = round === 'l2' ? 'l1' : round === 'l3' ? 'l2' : null;
    const reset = correction && dto.resetFollowingRounds &&
      ROUND_KEYS.slice(0, ROUND_KEYS.indexOf(round)).some(key => existing[`${key}Status`] === 'CLEARED' && changes[`${key}Status`] !== undefined && changes[`${key}Status`] !== 'CLEARED') &&
      changes[`${round}Status`] === 'PENDING' && changes[`${round}Date`] === null && changes[`${round}Remarks`] === null && changes[`${round}Interviewer`] === null;
    if (prior && !reset && (merged[`${prior}Status`] !== 'CLEARED' || (round === 'l3' && merged.l1Status !== 'CLEARED'))) throw new BadRequestException('Clear the previous interview round first.');
    const status = merged[`${round}Status`];
    if (dto[`${round}Color`] !== undefined && dto[`${round}Color`] !== null && !['blue', 'violet', 'rose', 'green', 'amber'].includes(dto[`${round}Color`])) throw new BadRequestException('Choose a valid calendar color.');
    if (dto[`${round}Color`] !== undefined) requirePermission(caps.schedule || caps.results[round]);
    if (dto[`${round}Status`] !== undefined && dto[`${round}Status`] !== null && !Object.values(InterviewRoundStatus).includes(dto[`${round}Status`])) throw new BadRequestException('Invalid interview result.');
    const scheduling = status === 'SCHEDULED';
    const appointmentChange = scheduling || status === 'CANCELLED' || (status === 'PENDING' && ['SCHEDULED', 'CANCELLED'].includes(existing[`${round}Status`]));
    if (dto[`${round}Status`] !== undefined) requirePermission(appointmentChange ? caps.schedule || caps.results[round] : caps.results[round]);
    const recordingResult = ['CLEARED', 'AWAITING_FEEDBACK'].includes(dto[`${round}Status`]) && dto[`${round}Status`] !== existing[`${round}Status`];
    if (recordingResult && (!['SCHEDULED', 'AWAITING_FEEDBACK', ...(correction ? ['CLEARED', 'REJECTED'] : [])].includes(existing[`${round}Status`]) || !existing[`${round}Date`] || !Number.isFinite(new Date(existing[`${round}Date`]).getTime()))) {
      throw new BadRequestException('Schedule this interview before recording its result.');
    }
    if (dto[`${round}Status`] === 'REJECTED' && existing[`${round}Status`] !== 'REJECTED') {
      const activeRound = ['l1', 'l2', 'l3'].find(key => existing[`${key}Status`] !== 'CLEARED');
      if (!correction && (existing.finalStatus !== 'SUBMITTED' || activeRound !== round || ![null, undefined, 'PENDING', 'SCHEDULED', 'AWAITING_FEEDBACK'].includes(existing[`${round}Status`]))) throw new BadRequestException('Only the current active round can be rejected.');
      if (typeof dto[`${round}Remarks`] !== 'string' || !dto[`${round}Remarks`].trim()) throw new BadRequestException('Add remarks for the stage rejection.');
    }
    if (dto[`${round}Status`] !== undefined && dto[`${round}Status`] !== existing[`${round}Status`] && ['CLEARED', 'REJECTED'].includes(existing[`${round}Status`]) && !correction) throw new BadRequestException('Provide a reason to correct a recorded round result.');
    if (dto[`${round}Status`] === 'CANCELLED' && (typeof dto[`${round}Remarks`] !== 'string' || !dto[`${round}Remarks`].trim())) throw new BadRequestException('Add remarks for the cancelled interview.');
    if (dto[`${round}Date`] !== undefined || dto[`${round}Interviewer`] !== undefined) requirePermission(caps.schedule || caps.results[round]);
    if (dto[`${round}Remarks`] !== undefined) requirePermission(caps.results[round] || (appointmentChange && caps.schedule));
    const date = merged[`${round}Date`];
    if (date && !Number.isFinite(new Date(date).getTime())) throw new BadRequestException('Invalid interview date.');
    if (scheduling && !date) throw new BadRequestException('Choose an interview date and time.');
    if (dto[`${round}Status`] === 'SCHEDULED') {
      const activeRound = ROUND_KEYS.find(key => merged[`${key}Status`] !== 'CLEARED');
      const laterRoundsPending = ROUND_KEYS.slice(ROUND_KEYS.indexOf(round) + 1).every(key => [null, undefined, 'PENDING'].includes(merged[`${key}Status`]) && !merged[`${key}Date`]);
      const canRescheduleCurrent = ['SCHEDULED', 'AWAITING_FEEDBACK'].includes(existing[`${round}Status`]);
      if ((dto.finalStatus ?? existing.finalStatus) !== 'SUBMITTED' || activeRound !== round || !laterRoundsPending ||
        (!canRescheduleCurrent && ![null, undefined, 'PENDING', 'CANCELLED'].includes(existing[`${round}Status`]))) {
        throw new BadRequestException('This submission is no longer eligible for interview scheduling. Refresh the eligible candidate list.');
      }
    }
    if (status === 'PENDING' && date) throw new BadRequestException('Schedule this round before adding an interview appointment.');
    if (['CLEARED', 'AWAITING_FEEDBACK'].includes(status) && !date && touched) throw new BadRequestException('A completed interview requires its recorded date and time.');
    if (recordingResult && date && new Date(date).getTime() > Date.now()) throw new BadRequestException('The interview must have taken place before recording feedback or clearance.');
  }
  for (let i = 1; i < ROUND_KEYS.length; i++) {
    const round = ROUND_KEYS[i];
    // Revalidate the whole resulting sequence whenever any round is changed.
    if (changedRound && (![null, undefined, 'PENDING'].includes(merged[`${round}Status`]) || merged[`${round}Date`]) &&
      ROUND_KEYS.slice(0, i).some(prior => merged[`${prior}Status`] !== 'CLEARED')) throw new BadRequestException('Clear the previous interview round first.');
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
    if (![...Object.values(SubmissionOutcome), 'PENDING_APPROVAL', 'REJECTED'].includes(dto.finalStatus)) throw new BadRequestException('Invalid submission outcome.');
    const derivedRejection = ['REJECTED', 'NOT_SELECTED'].includes(dto.finalStatus) && ['l1', 'l2', 'l3'].some(round => dto[`${round}Status`] === 'REJECTED');
    if (derivedRejection && existing.finalStatus !== 'SUBMITTED') requirePermission(caps.outcome);
    if (!derivedRejection) {
      requirePermission(existing.finalStatus === 'PENDING_APPROVAL' ? caps.review : caps.outcome);
      if (existing.finalStatus === 'PENDING_APPROVAL' && !['SUBMITTED', 'REJECTED'].includes(dto.finalStatus)) throw new BadRequestException('Approve or reject internal review first.');
      if (dto.finalStatus === 'PENDING_APPROVAL' && existing.finalStatus !== 'PENDING_APPROVAL') throw new BadRequestException('This action cannot undo internal approval.');
      const progression = ['SUBMITTED', 'SELECTED', 'OFFER', 'JOIN'];
      const movingBackward = progression.includes(dto.finalStatus) && progression.indexOf(dto.finalStatus) < progression.indexOf(existing.finalStatus);
      if ((terminal || movingBackward) && dto.finalStatus !== existing.finalStatus && !correction) throw new BadRequestException('Provide a correction reason to reopen or correct the final outcome.');
      if (['SELECTED', 'OFFER', 'JOIN'].includes(dto.finalStatus)) {
        if (merged.l1Status !== 'CLEARED' || ROUND_KEYS.some(round => merged[`${round}Status`] === 'REJECTED')) throw new BadRequestException('Clear L1 and correct any rejected interview before selecting, offering or joining.');
        const bypass = ROUND_KEYS.some(round => ['SCHEDULED', 'AWAITING_FEEDBACK'].includes(merged[`${round}Status`])) ||
          (dto.finalStatus === 'OFFER' && !['SELECTED', 'OFFER'].includes(existing.finalStatus)) ||
          (dto.finalStatus === 'JOIN' && !['OFFER', 'JOIN'].includes(existing.finalStatus));
        if (dto.finalStatus !== existing.finalStatus && bypass && !dto.bypassReason?.trim()) throw new BadRequestException('Record a reason for the direct outcome or unfinished interview.');
      }
      if (['NOT_SELECTED', 'WITHDRAWN', 'REJECTED'].includes(dto.finalStatus) && dto.finalStatus !== existing.finalStatus && !dto.remarks?.trim()) throw new BadRequestException('Add remarks for the final outcome.');
    }
  }
  const outcome = dto.finalStatus ?? existing.finalStatus;
  if (dto.finalStatus === 'SUBMITTED' && existing.finalStatus !== 'PENDING_APPROVAL' && ROUND_KEYS.some(round => merged[`${round}Status`] === 'REJECTED')) throw new BadRequestException('Correct the rejected round before returning the submission to In progress.');
  if (changedRound && ['SELECTED', 'OFFER', 'JOIN'].includes(outcome) && (merged.l1Status !== 'CLEARED' || ROUND_KEYS.some(round => existing[`${round}Status`] === 'CLEARED' && merged[`${round}Status`] !== 'CLEARED'))) throw new BadRequestException('Return the final outcome to In progress when correcting a cleared round.');
  if (dto.remarks !== undefined) requirePermission(caps.notes || (dto.finalStatus !== undefined && (caps.review || caps.outcome)));
  if (dto.expectedUpdatedAt !== undefined && !Number.isFinite(new Date(dto.expectedUpdatedAt).getTime())) throw new BadRequestException('Invalid submission version.');
  if (!changedRound && Object.keys(dto).every(key => ['expectedUpdatedAt', 'requestId', 'bypassReason', 'correctionReason', 'resetFollowingRounds'].includes(key))) throw new BadRequestException('No changes to save.');
}
