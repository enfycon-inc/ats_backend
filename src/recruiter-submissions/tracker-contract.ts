// Canonical submission tracker contract. Run node ats_frontend_main/scripts/sync-submission-contract.cjs
// from the workspace root to update the frontend's generated contract.
export type TrackerBucket = 'all' | 'review' | 'interviews' | 'offers' | 'closed';
export type RoundKey = 'l1' | 'l2' | 'l3';
export interface SubmissionCapabilities {
  review: boolean;
  schedule: boolean;
  results: Record<RoundKey, boolean>;
  outcome: boolean;
  notes: boolean;
  rate: boolean;
}
export interface TrackerSubmission {
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
  candidateSkills?: string[] | null;
  jobCode?: string;
  jobTitle?: string;
  clientName?: string;
  endClientName?: string;
  recruiterName?: string;
  accountManagerName?: string;
  branchId?: string | null;
  timezone?: string | null;
  createdAt: string;
  updatedAt: string;
  capabilities?: SubmissionCapabilities;
}
export interface TrackerResponse {
  data: TrackerSubmission[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: Record<TrackerBucket, number>;
}
export interface TrackerUpdate {
  assessmentVersion?: string;
  reviewOverrides?: Record<string, 'Meets' | 'Does not meet' | 'Needs clarification'>;
  requestId?: string;
  bypassReason?: string;
  expectedUpdatedAt?: string;
  l1Status?: string | null;
  l2Status?: string | null;
  l3Status?: string | null;
  l1Date?: string | null;
  l2Date?: string | null;
  l3Date?: string | null;
  l1Remarks?: string | null;
  l2Remarks?: string | null;
  l3Remarks?: string | null;
  l1Interviewer?: string | null;
  l2Interviewer?: string | null;
  l3Interviewer?: string | null;
  finalStatus?: string;
  remarks?: string | null;
  reviewFeedback?: string | null;
  recruiterComment?: string | null;
  submittedRate?: string;
  meetingLink?: string | null;
}

export interface SubmissionHistoryEvent {
  id: string;
  kind: 'BASELINE' | 'CREATED' | 'UPDATE';
  actorName: string | null;
  createdAt: string;
  details: {
    assessment?: CandidateAssessment;
    reviewOverrides?: Record<string, string>;
    changes?: Record<string, { before: string | null; after: string | null }>;
    snapshot?: Record<string, string | null>;
    bypassReason?: string;
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
