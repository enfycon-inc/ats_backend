/**
 * Represents the structured profile for a Candidate returned from the Candidates Module
 */
export interface CandidateProfile {
  capabilities?: { edit: boolean; changeMarket: boolean };
  id: string;
  dbId?: string;
  resumeFilename?: string | null;
  resumeUploadedAt?: string | null;
  candidateCode?: string;
  uploadedByUserId?: string | null;
  uploadedByName?: string | null;
  uploadedByEmail?: string | null;
  uploadedByAvatar?: string | null;
  market?: string;
  updatedAt?: string | null;
  assignedJobs?: { id: string; jobCode: string; jobTitle: string }[];
  assignedJobCount?: number;
  applicantId: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  currentLocation?: string | null;
  currentCompany?: string | null;
  relevantExperienceYears?: number | null;
  availabilityToStart?: string | null;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: string;
  status: string;
  jobTitle: string;
  skills: string[];
  workAuthorization: string;
  experienceYears: number;
  rawText: string;
  createdOn: string;
  currentCTC?: number | null;
  expectedCTC?: number | null;
  noticePeriodDays?: number;
  servingNotice?: boolean;
  lastWorkingDay?: string | null;
  panCard?: string | null;
  preferredLocations?: string[];
  preferredLocationMode?: 'SPECIFIC_LOCATIONS' | 'REMOTE_ONLY' | 'REMOTE_OR_LOCATIONS' | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Legacy parser payload has provider-specific fields.
  parsedJson?: any;
}

/**
 * Raw DB Row representations from Supabase postgres
 */
export interface CandidateDbRow {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  current_location_id?: number;
  raw_current_location?: string;
  total_experience_years?: number;
  current_designation_id?: number;
  raw_current_designation?: string;
  created_at: Date | string;
  resume_record_id?: number;
  source: string;
  work_authorization?: string;
}
