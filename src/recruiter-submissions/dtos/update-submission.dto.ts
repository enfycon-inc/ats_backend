import type { TrackerUpdate } from '../tracker-contract';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { InterviewRoundStatus, SubmissionOutcome } from '../tracker-contract';

export class UpdateSubmissionDto implements TrackerUpdate {
  @ApiPropertyOptional({ description: 'Required reason for correcting a previously recorded decision.' })
  correctionReason?: string;
  @ApiPropertyOptional({ description: 'Explicit confirmation to reset rounds invalidated by an earlier correction.' })
  resetFollowingRounds?: boolean;
  assessmentVersion?: string;
  reviewOverrides?: Record<string, 'Meets' | 'Does not meet' | 'Needs clarification'>;
  requestId?: string;
  bypassReason?: string;
  @ApiPropertyOptional({ description: 'Version read by the editor; rejects stale writes.' })
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The UUID of the Job Requisition',
  })
  jobId?: string;

  @ApiPropertyOptional({
    example: 42,
    description: 'The integer ID of the parsed Candidate profile',
  })
  candidateId?: number;

  @ApiPropertyOptional({
    example: 'recruiter-uuid-or-name',
    description: 'The identifier of the submitting recruiter',
  })
  recruiterId?: string;

  @ApiPropertyOptional({
    example: 'CLEARED',
    enum: InterviewRoundStatus,
    description: 'Updated L1 interview status',
  })
  l1Status?: TrackerUpdate['l1Status'];

  @ApiPropertyOptional({
    example: '2026-05-21T10:00:00.000Z',
    description: 'L1 interview schedule date',
  })
  l1Date?: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: InterviewRoundStatus,
    description: 'Updated L2 interview status',
  })
  l2Status?: TrackerUpdate['l2Status'];

  @ApiPropertyOptional({
    example: '2026-05-22T10:00:00.000Z',
    description: 'L2 interview schedule date',
  })
  l2Date?: string;

  @ApiPropertyOptional({
    example: 'PENDING',
    enum: InterviewRoundStatus,
    description: 'Updated L3 interview status',
  })
  l3Status?: TrackerUpdate['l3Status'];

  @ApiPropertyOptional({
    example: '2026-05-23T10:00:00.000Z',
    description: 'L3 interview schedule date',
  })
  l3Date?: string;

  @ApiPropertyOptional({ enum: ['blue', 'violet', 'rose', 'green', 'amber'], description: 'Calendar color for the interview round' })
  l1Color?: TrackerUpdate['l1Color'];
  @ApiPropertyOptional({ enum: ['blue', 'violet', 'rose', 'green', 'amber'], description: 'Calendar color for the interview round' })
  l2Color?: TrackerUpdate['l2Color'];
  @ApiPropertyOptional({ enum: ['blue', 'violet', 'rose', 'green', 'amber'], description: 'Calendar color for the interview round' })
  l3Color?: TrackerUpdate['l3Color'];

  @ApiPropertyOptional({
    example: 'SUBMITTED',
    enum: [...Object.values(SubmissionOutcome), 'PENDING_APPROVAL', 'REJECTED'],
    description: 'Final status of candidate submission',
  })
  finalStatus?: TrackerUpdate['finalStatus'];

  @ApiPropertyOptional({
    example: 'Strong technical match with dbt experience.',
    description: 'General remarks or feedback about stages',
  })
  remarks?: string;

  @ApiPropertyOptional({
    example: 'Candidate is looking for 100% remote work.',
    description: 'Specific notes or comments added by the recruiter',
  })
  recruiterComment?: string;

  @ApiPropertyOptional({
    example: '$75/hr or 12 Lakh',
    description: 'The submitted rate or gross salary for the candidate',
  })
  submittedRate?: string;

  @ApiPropertyOptional({ description: 'Snapshot: candidate current CTC' })
  candidateCurrentCtc?: number;

  @ApiPropertyOptional({ description: 'Snapshot: candidate expected CTC' })
  candidateExpectedCtc?: number;

  @ApiPropertyOptional({ description: 'Snapshot: candidate notice period' })
  candidateNoticePeriod?: number;

  @ApiPropertyOptional({ description: 'Snapshot: candidate relevant experience' })
  candidateRelevantExperience?: number;

  @ApiPropertyOptional({ description: 'Internal team lead or pod lead approval remarks' })
  podLeadRemarks?: string;

  @ApiPropertyOptional({ description: 'Review feedback from Account Manager / Pod Lead during internal review' })
  reviewFeedback?: string;

  @ApiPropertyOptional({ description: 'L1 Interview feedback / client comments' })
  l1Remarks?: string;

  @ApiPropertyOptional({ description: 'L1 Interviewer name' })
  l1Interviewer?: string;

  @ApiPropertyOptional({ description: 'L2 Technical interview feedback / client comments' })
  l2Remarks?: string;

  @ApiPropertyOptional({ description: 'L2 Interviewer name' })
  l2Interviewer?: string;

  @ApiPropertyOptional({ description: 'L3 Final interview feedback / client comments' })
  l3Remarks?: string;

  @ApiPropertyOptional({ description: 'L3 Interviewer name' })
  l3Interviewer?: string;

  @ApiPropertyOptional({ example: 'https://meet.google.com/abc-xyz', description: 'Meeting URL link for Google Meet / Teams / Zoom' })
  meetingLink?: string;
}
