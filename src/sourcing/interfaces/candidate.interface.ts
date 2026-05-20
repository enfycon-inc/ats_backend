/**
 * Represents a candidate profile retrieved from an external job board (Dice or Monster).
 * Obfuscated email/phone fields are standard for external profiles before they are downloaded/unlocked.
 */
export interface ExternalCandidate {
  externalId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  currentTitle: string;
  currentCompany: string;
  skills: string[];
  experienceYears: number;
  workAuthorization: string;
  source: 'dice' | 'monster';
  resumeHtml: string;
  resumeText: string;
}

/**
 * Represents the final candidate profile persisted inside our internal ATS database
 * after downloading and parsing the resume.
 */
export interface InternalCandidateProfile {
  id: string;
  applicantId: string;
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: 'Dice' | 'Monster';
  status: 'New lead';
  jobTitle: string;
  skills: string[];
  workAuthorization: string;
  experienceYears: number;
  rawText: string;
  createdOn: string;
}
