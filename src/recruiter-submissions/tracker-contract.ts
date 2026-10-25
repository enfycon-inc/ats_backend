// Canonical submission tracker contract. Run node ats_frontend_main/scripts/sync-submission-contract.cjs
// from the workspace root to update the frontend's generated contract.
export type TrackerBucket = 'all' | 'review' | 'interviews' | 'offers' | 'closed';
export const TRACKER_SORT_KEYS = ['job', 'manager', 'recruiter', 'candidate', 'pipeline', 'status', 'jobCreated', 'submitted'] as const;
export type TrackerSortKey = typeof TRACKER_SORT_KEYS[number];
export type TrackerSortDirection = 'asc' | 'desc';
export interface TrackerListFilters {
  page?: number;
  limit?: number;
  view?: string;
  bucket?: TrackerBucket;
  jobId?: string;
  candidateId?: string;
  branchId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  l1Status?: string;
  l2Status?: string;
  l3Status?: string;
  finalStatus?: string;
  sortBy?: TrackerSortKey;
  sortDirection?: TrackerSortDirection;
}
export type RoundKey = 'l1' | 'l2' | 'l3';
export type InterviewColor = 'blue' | 'violet' | 'rose' | 'green' | 'amber';
export enum InterviewRoundStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  AWAITING_FEEDBACK = 'AWAITING_FEEDBACK',
  CLEARED = 'CLEARED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}
export enum SubmissionOutcome {
  IN_PROGRESS = 'SUBMITTED',
  SELECTED = 'SELECTED',
  NOT_SELECTED = 'NOT_SELECTED',
  OFFER_ISSUED = 'OFFER',
  JOINED = 'JOIN',
  WITHDRAWN = 'WITHDRAWN',
}
export const ROUND_STATUS_LABELS: Record<InterviewRoundStatus, string> = {
  PENDING: 'Pending', SCHEDULED: 'Scheduled', AWAITING_FEEDBACK: 'Awaiting feedback',
  CLEARED: 'Cleared', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
export const OUTCOME_LABELS: Record<SubmissionOutcome, string> = {
  SUBMITTED: 'In progress', SELECTED: 'Selected', NOT_SELECTED: 'Not selected',
  OFFER: 'Offer issued', JOIN: 'Joined', WITHDRAWN: 'Withdrawn',
};
export interface SubmissionCapabilities {
  review: boolean;
  schedule: boolean;
  cancelInterview?: boolean;
  results: Record<RoundKey, boolean>;
  outcome: boolean;
  notes: boolean;
  rate: boolean;
}
export interface TrackerSubmission {
  jobStatus?: string | null;
  keepExistingSubmissionsOpen?: boolean;
  workflowPaused?: boolean;
  resume?: { available: boolean; filename: string | null; canDownload: boolean };
  statusRecordedDates?: Partial<Record<'finalStatus' | 'l1Status' | 'l2Status' | 'l3Status', string>>;
  currentCompensationAmount?: string | null;
  expectedCompensationAmount?: string | null;
  compensationCurrency?: string | null;
  compensationPeriod?: string | null;
  compensationInputUnit?: string | null;
  candidateSource?: string | null;
  sourceCategory?: string | null;
  sourceChannel?: string | null;
  sourceDetail?: string | null;
  availabilityToStart?: string | null;

  candidateFirstName?: string | null;
  candidateLastName?: string | null;
  candidateCurrentCompany?: string | null;
  candidateRelevantExperience?: number | null;
  candidatePreferredLocations?: string[] | null;
  candidateCurrentCtc?: string | null;
  candidateExpectedCtc?: string | null;
  candidateCtcCurrency?: string | null;
  candidateCtcTerm?: string | null;
  jobType?: string | null;
  recruiterAvatar?: string | null;
  rejectionFromStatus?: string | null;
  jobUrgency?: string | null;
  jobIsCoSourced?: boolean;
  submissionNumber?: number | null;
  matchingJobSubmissionCount?: number;
  jobDescription?: string | null;
  jobSkillsRequired?: string[] | null;
  jobSecondarySkills?: string[] | null;
  jobExperienceMin?: number | null;
  jobExperienceMax?: number | null;
  jobLocation?: string | null;
  jobWorkMode?: string | null;
  jobDegree?: string | null;
  jobNoticePeriod?: string | null;
  candidateNoticePeriod?: number | null;
  currentRoundKey?: RoundKey | null;
  id: string;
  jobId: string;
  candidateId: string;
  recruiterId: string;
  l1Status: string | null;
  l2Status: string | null;
  l3Status: string | null;
  l1Date: string | null;
  l2Date: string | null;
  l3Date: string | null;
  l1Remarks?: string | null;
  l2Remarks?: string | null;
  l3Remarks?: string | null;
  l1Interviewer?: string | null;
  l2Interviewer?: string | null;
  l3Interviewer?: string | null;
  l1Color?: InterviewColor | null;
  l2Color?: InterviewColor | null;
  l3Color?: InterviewColor | null;
  finalStatus: string;
  remarks: string | null;
  recruiterComment: string | null;
  reviewFeedback?: string | null;
  podLeadRemarks?: string | null;
  meetingLink?: string | null;
  submittedRate?: string | null;
  submittedRateCurrency?: string | null;
  submittedRateTerm?: string | null;
  candidateName?: string;
  candidateEmail?: string;
  candidatePhone?: string;
  candidateCurrentLocation?: string;
  candidateExperience?: number | null;
  candidateDesignation?: string | null;
  candidateSkills?: string[] | null;
  verifiedCandidate?: Record<string, string | string[]> | null;
  jobCode?: string;
  jobTitle?: string;
  clientName?: string;
  endClientName?: string;
  recruiterName?: string;
  recruiterEmail?: string | null;
  accountManagerName?: string;
  accountManagerId?: string | null;
  accountManagerRole?: string | null;
  accountManagerEmail?: string | null;
  jobCreatedAt?: string | null;
  jobSubmissionRequired?: number | null;
  jobSubmissionDone?: number | null;
  branchId?: string | null;
  timezone?: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities?: SubmissionCapabilities;
}
export interface TrackerResponse {
  dashboardMetrics: { submissions: number; interviews: number; selections: number };
  accountManagerLabel?: string;
  data: TrackerSubmission[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<TrackerBucket, number>;
}
export interface EligibleInterviewCandidate {
  id: string;
  candidateName: string;
  jobCode: string;
  jobTitle: string;
  finalStatus: string;
  eligibleRound: RoundKey;
}
export interface EligibleInterviewResponse {
  data: EligibleInterviewCandidate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
export interface TrackerDashboardSummary {
  rangeDays: 7 | 30 | 90;
  activity: Array<{ date: string; submissions: number; interviews: number }>;
  pipeline: Array<{ stage: string; count: number }>;
  dashboardMetrics: { submissions: number; interviews: number; selections: number };
}
export interface TrackerStatsResponse {
  total: number;
  l1Pending: number;
  l2Pending: number;
  l3Pending: number;
  dashboard?: TrackerDashboardSummary;
}
export interface TrackerUpdate {
  correctionReason?: string;
  resetFollowingRounds?: boolean;
  assessmentVersion?: string;
  reviewOverrides?: Record<string, 'Meets' | 'Does not meet' | 'Needs clarification'>;
  requestId?: string;
  bypassReason?: string;
  expectedUpdatedAt?: string;
  l1Status?: `${InterviewRoundStatus}` | null;
  l2Status?: `${InterviewRoundStatus}` | null;
  l3Status?: `${InterviewRoundStatus}` | null;
  l1Date?: string | null;
  l2Date?: string | null;
  l3Date?: string | null;
  l1Remarks?: string | null;
  l2Remarks?: string | null;
  l3Remarks?: string | null;
  l1Interviewer?: string | null;
  l2Interviewer?: string | null;
  l3Interviewer?: string | null;
  l1Color?: InterviewColor | null;
  l2Color?: InterviewColor | null;
  l3Color?: InterviewColor | null;
  finalStatus?: `${SubmissionOutcome}` | 'PENDING_APPROVAL' | 'REJECTED';
  remarks?: string | null;
  reviewFeedback?: string | null;
  recruiterComment?: string | null;
  submittedRate?: string;
  meetingLink?: string | null;
}

export interface SubmissionHistoryEvent {
  actorEmail?: string | null;
  actorAvatar?: string | null;
  id: string;
  kind: 'BASELINE' | 'CREATED' | 'UPDATE';
  actorName: string | null;
  createdAt: string;
  details: {
    actorEmail?: string | null;
    assessment?: CandidateAssessment;
    reviewOverrides?: Record<string, string>;
    changes?: Record<string, { before: string | null; after: string | null }>;
    snapshot?: Record<string, string | null>;
    bypassReason?: string;
    correctionReason?: string;
    resetFollowingRounds?: boolean;
  };
}

export interface AssessmentCriterion {
  key: string;
  requirement: string;
  category: string;
  finding: 'EVIDENCE_FOUND' | 'NO_EVIDENCE' | 'MEETS' | 'DOES_NOT_MEET' | 'NEEDS_CLARIFICATION';
  evidence: string;
}
export interface CandidateAssessment {
  additionalCandidateSkills?: string[];
  candidateSnapshot?: {
    experienceYears: number | null;
    noticePeriodDays: number | null;
    currentLocation: string | null;
  };
  candidateQualifications?: string[];
  engine: string;
  version: string;
  calculatedAt: string;
  score: number | null;
  coverage: number;
  criteria: AssessmentCriterion[];
  breakdown: { label: string; weight: number; score: number | null }[];
  limitations: string[];
}
export interface SubmissionHistoryResponse {
  data: SubmissionHistoryEvent[];
  page: number;
  total: number;
  totalPages: number;
}

/** Personal recruiter dashboard. Counts cover the full scope, not displayed pages. */
export interface RecruiterDashboardData {
  rangeDays: 0 | 7 | 30 | 90;
  pendingJobs: number;
  totalActiveJobs: number;
  jobs: Array<{ id: string; jobTitle: string; jobCode: string; jobType: string; market: string; client: string; priority: string; assignedAt: string; submissionDone: number; submissionRequired: number; canSubmit: boolean; canMatch: boolean }>;
  metrics: { jobs: number; submissions: number; rejected: number; selected: number; interviews: number };
  submissionStages: Array<{ label: string; count: number }>;
  interviewOutcomes: Array<{ label: string; count: number }>;
  calendar: RecruiterInterview[];
  calendarTruncated: boolean;
  upcoming: RecruiterInterview[];
}
export interface RecruiterInterview {
  id: string; submissionId: string; candidateName: string; jobTitle: string; round: string; status: string;
  date: string; timezone: string | null; interviewer: string | null; meetingLink: string | null;
}
