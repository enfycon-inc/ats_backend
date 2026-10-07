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
