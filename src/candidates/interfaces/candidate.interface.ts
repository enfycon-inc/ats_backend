/**
 * Represents the structured profile for a Candidate returned from the Candidates Module
 */
export interface CandidateProfile {
  id: string;
  applicantId: string;
  fullName: string;
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
