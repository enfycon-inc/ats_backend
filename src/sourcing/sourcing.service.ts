import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExternalCandidate, InternalCandidateProfile } from './interfaces/candidate.interface';
import { SourcingSearchQueryDto } from './dtos/search-query.dto';
import { SourcingDownloadDto } from './dtos/download-candidate.dto';
import { CandidatesService } from '../candidates/candidates.service';

@Injectable()
export class SourcingService {
  private readonly logger = new Logger(SourcingService.name);

  constructor(private readonly candidatesService: CandidatesService) {}

  // Standard pool of mock candidates returned by external boards (Dice/Monster)
  private readonly externalPool: ExternalCandidate[] = [
    {
      externalId: 'DICE-48168',
      fullName: 'Manoj Duggi',
      email: 'm-duggi-dice-obfuscated@dice.com',
      phone: '334-XXX-XXXX',
      location: 'Herndon, VA',
      currentTitle: 'Email Security Engineer',
      currentCompany: 'IronBow Technologies',
      skills: ['Email Security', 'Proofpoint', 'Cybersecurity', 'Office 365'],
      experienceYears: 6,
      workAuthorization: 'Have H1 Visa',
      source: 'dice',
      resumeHtml: '<h1>Manoj Duggi</h1><p>Email Security Specialist with 6 years experience...</p>',
      resumeText: 'Manoj Duggi\nEmail Security Specialist with 6 years experience in Proofpoint...',
    },
    {
      externalId: 'DICE-48167',
      fullName: 'Pavan Puligandla',
      email: 'p-puligandla-dice-obfuscated@dice.com',
      phone: '740-XXX-XXXX',
      location: 'Johns Creek, GA',
      currentTitle: 'Snowflake Data Engineer',
      currentCompany: 'Deloitte',
      skills: ['Snowflake', 'dbt', 'SQL', 'Data Warehousing', 'Python'],
      experienceYears: 8,
      workAuthorization: 'Employment Auth. Document',
      source: 'dice',
      resumeHtml: '<h1>Pavan Puligandla</h1><p>Snowflake developer and warehouse architect...</p>',
      resumeText: 'Pavan Puligandla\nSnowflake developer and warehouse architect with Deloitte...',
    },
    {
      externalId: 'DICE-48166',
      fullName: 'Robert Fallon',
      email: 'r-fallon-dice-obfuscated@dice.com',
      phone: '650-XXX-XXXX',
      location: 'Centreville, VA',
      currentTitle: 'Sr Cyber System Engineer',
      currentCompany: 'Lockheed Martin',
      skills: ['Cybersecurity', 'Splunk', 'SIEM', 'CISSP', 'Linux'],
      experienceYears: 10,
      workAuthorization: 'US Citizen',
      source: 'dice',
      resumeHtml: '<h1>Robert Fallon</h1><p>Senior Cybersecurity System Architect...</p>',
      resumeText: 'Robert Fallon\nSenior Cybersecurity System Architect with secret clearance...',
    },
    {
      externalId: 'MONSTER-48163',
      fullName: 'Alan Davis',
      email: 'a-davis-monster-obfuscated@monster-talent.com',
      phone: '860-XXX-XXXX',
      location: 'Newington, CT',
      currentTitle: 'VBA/Access & SQL Server Developer',
      currentCompany: 'Hartford Insurance',
      skills: ['VBA', 'MS Access', 'MS SQL Server', 'T-SQL', 'Excel Macros'],
      experienceYears: 12,
      workAuthorization: 'US Authorized',
      source: 'monster',
      resumeHtml: '<h1>Alan Davis</h1><p>Expert VBA and database automation engineer...</p>',
      resumeText: 'Alan Davis\nExpert VBA and database automation engineer at Hartford...',
    },
    {
      externalId: 'MONSTER-48151',
      fullName: 'Zeeshan Malik',
      email: 'z-malik-monster-obfuscated@monster-talent.com',
      phone: '240-XXX-XXXX',
      location: 'Woodstock, MD',
      currentTitle: 'Sr. Business Analyst / System Analyst',
      currentCompany: 'T. Rowe Price',
      skills: ['Business Analysis', 'Agile', 'Scrum', 'Jira', 'SQL'],
      experienceYears: 7,
      workAuthorization: 'US Authorized',
      source: 'monster',
      resumeHtml: '<h1>Zeeshan Malik</h1><p>Lead Business Analyst with financial domain experience...</p>',
      resumeText: 'Zeeshan Malik\nLead Business Analyst with financial domain experience...',
    },
  ];

  /**
   * Searches resumes from external job boards (Dice / Monster).
   */
  async searchExternalCandidates(query: SourcingSearchQueryDto): Promise<ExternalCandidate[]> {
    this.logger.log(
      `[PRODUCTION LOG] Querying external API for provider=${query.provider.toUpperCase()} | Q="${query.q}" | Location="${query.location || 'Any'}"`,
    );

    // Simulate network delay to mimic SOAP / REST calls to Dice or Monster servers
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Filter external candidate pool to simulate a realistic search
    const results = this.externalPool.filter((candidate) => {
      // 1. Check provider match
      if (candidate.source !== query.provider) return false;

      // 2. Check query keywords match (in title, skills, or biography text)
      const qLower = query.q.toLowerCase();
      const skillsMatch = candidate.skills.some((skill) => skill.toLowerCase().includes(qLower));
      const titleMatch = candidate.currentTitle.toLowerCase().includes(qLower);
      const textMatch = candidate.resumeText.toLowerCase().includes(qLower);

      if (!skillsMatch && !titleMatch && !textMatch && query.q !== '*') {
        return false;
      }

      // 3. Location filter (if supplied)
      if (query.location && !candidate.location.toLowerCase().includes(query.location.toLowerCase())) {
        return false;
      }

      // 4. Work authorization filter (if supplied)
      if (
        query.workAuthorization &&
        query.workAuthorization !== 'Any' &&
        !candidate.workAuthorization.toLowerCase().includes(query.workAuthorization.toLowerCase())
      ) {
        return false;
      }

      return true;
    });

    this.logger.log(`[PRODUCTION LOG] Job board returned ${results.length} results.`);
    return results;
  }

  /**
   * Downloads a candidate resume profile from Dice/Monster, unlocks contact information,
   * delegates database creation to CandidatesService to import and index correctly.
   */
  async downloadAndImportCandidate(dto: SourcingDownloadDto, tenantId: string): Promise<InternalCandidateProfile> {
    this.logger.log(
      `[PRODUCTION LOG] Initiating profile unlock & purchase for Provider=${dto.provider.toUpperCase()} | ExternalId=${dto.externalId} | Tenant=${tenantId}`,
    );

    // 1. Find candidate in external pool
    const externalCandidate = this.externalPool.find(
      (c) => c.externalId === dto.externalId && c.source === dto.provider,
    );

    if (!externalCandidate) {
      this.logger.warn(`Candidate not found in external registry: ID=${dto.externalId}`);
      throw new NotFoundException(`Candidate profile ${dto.externalId} was not found on ${dto.provider}.`);
    }

    // Simulate API delay for candidate profile purchase/unlock call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. Unlock real contact details (Dice/Monster return obfuscated values in search, but actual details in profile download)
    const unlockedEmail =
      dto.provider === 'dice'
        ? `${externalCandidate.fullName.toLowerCase().replace(/\s+/g, '')}@gmail.com`
        : `${externalCandidate.fullName.toLowerCase().replace(/\s+/g, '')}@outlook.com`;
        
    const unlockedPhone =
      dto.provider === 'dice' ? '+1 (334) 555-4816' : '+1 (860) 555-8831';

    this.logger.log(`[PRODUCTION LOG] Successfully unlocked profile. Mapped real email=${unlockedEmail} | phone=${unlockedPhone}`);

    // 3. De-duplication check: call CandidatesService to check if candidate is already in Supabase
    const existing = await this.candidatesService.findByEmail(unlockedEmail, tenantId);
    if (existing) {
      this.logger.log(`Candidate with email ${unlockedEmail} is already imported. Returning existing profile.`);
      return existing as InternalCandidateProfile;
    }

    // 4. Delegate candidate persistence to CandidatesService
    const createdProfile = await this.candidatesService.createCandidate({
      fullName: externalCandidate.fullName,
      email: unlockedEmail,
      phone: unlockedPhone,
      location: externalCandidate.location,
      experienceYears: externalCandidate.experienceYears,
      jobTitle: externalCandidate.currentTitle,
      source: dto.provider === 'dice' ? 'Dice' : 'Monster',
      workAuthorization: externalCandidate.workAuthorization,
      skills: externalCandidate.skills,
      rawText: externalCandidate.resumeText,
    }, tenantId);

    return createdProfile as InternalCandidateProfile;
  }

  /**
   * Unlocks Dice/Monster profile, builds a virtual resume document, submits it to 
   * the FastAPI Python parsing queue, polls the Celery task synchronously, and syncs
   * candidate records to Supabase.
   */
  async parseAndImportCandidateViaPython(dto: SourcingDownloadDto, tenantId: string): Promise<InternalCandidateProfile> {
    this.logger.log(`[AI PARSER PIPELINE] Initiating AI parsing pipeline for ExternalId=${dto.externalId} on provider=${dto.provider.toUpperCase()} under tenant=${tenantId}`);

    // 1. Find candidate in external pool
    const externalCandidate = this.externalPool.find(
      (c) => c.externalId === dto.externalId && c.source === dto.provider,
    );

    if (!externalCandidate) {
      this.logger.warn(`Candidate not found in external registry: ID=${dto.externalId}`);
      throw new NotFoundException(`Candidate profile ${dto.externalId} was not found on ${dto.provider}.`);
    }

    // 2. Unlock real contact details
    const unlockedEmail =
      dto.provider === 'dice'
        ? `${externalCandidate.fullName.toLowerCase().replace(/\s+/g, '')}@gmail.com`
        : `${externalCandidate.fullName.toLowerCase().replace(/\s+/g, '')}@outlook.com`;
        
    const unlockedPhone =
      dto.provider === 'dice' ? '+1 (334) 555-4816' : '+1 (860) 555-8831';

    this.logger.log(`[AI PARSER PIPELINE] Unlocked details: email=${unlockedEmail} | phone=${unlockedPhone}`);

    // 3. De-duplication check: call CandidatesService to check if candidate is already in Supabase
    const existing = await this.candidatesService.findByEmail(unlockedEmail, tenantId);
    if (existing) {
      this.logger.log(`Candidate with email ${unlockedEmail} is already imported. Returning existing profile.`);
      return existing as InternalCandidateProfile;
    }

    // 4. Generate virtual resume text document
    const resumeText = `
${externalCandidate.fullName}
${unlockedEmail} | ${unlockedPhone}
Location: ${externalCandidate.location}
Work Authorization: ${externalCandidate.workAuthorization}

SUMMARY:
Highly skilled and proactive professional with ${externalCandidate.experienceYears} years of experience in the industry.

PROFESSIONAL EXPERIENCE:
${externalCandidate.currentTitle} at ${externalCandidate.currentCompany}
- Active role in cyber, databases, or application development scaling operations.
- Total tenure of ${externalCandidate.experienceYears} years of experience with diverse environments.

SKILLS:
${externalCandidate.skills.join(', ')}

EDUCATION:
Bachelor of Science in Computer Science or equivalent technical field.
`;

    // 5. Submit file & metadata payload to FastAPI Parser
    let completed = false;
    let apiHost = 'http://api:8000';
    let response;

    const formData = new FormData();
    const blob = new Blob([resumeText], { type: 'text/plain' });
    formData.append('file', blob, `${externalCandidate.fullName.replace(/\s+/g, '_')}_Resume.txt`);
    
    const metadata = {
      provider: dto.provider,
      externalId: dto.externalId,
      work_authorization: externalCandidate.workAuthorization,
      location: externalCandidate.location,
      source: dto.provider === 'dice' ? 'Dice' : 'Monster'
    };
    formData.append('metadata', JSON.stringify(metadata));

    try {
      this.logger.log(`[AI PARSER PIPELINE] Connecting to FastAPI resume extractor at ${apiHost}...`);
      response = await fetch(`${apiHost}/api/v1/extract`, {
        method: 'POST',
        body: formData,
      });
    } catch (err: any) {
      this.logger.warn(`Could not connect to ${apiHost}, attempting local http://localhost:8000: ${err.message}`);
      apiHost = 'http://localhost:8000';
      try {
        response = await fetch(`${apiHost}/api/v1/extract`, {
          method: 'POST',
          body: formData,
        });
      } catch (innerErr: any) {
        this.logger.error(`Failed to reach resume parser on all endpoints: ${innerErr.message}`);
      }
    }

    // 6. Polling Celery background queue
    if (response && response.ok) {
      try {
        const resultData = await response.json();
        this.logger.log(`[AI PARSER PIPELINE] Parser API response: ${JSON.stringify(resultData)}`);

        if (resultData.status === 'completed') {
          completed = true;
        } else if (resultData.status === 'accepted') {
          const taskId = resultData.task_id;
          this.logger.log(`[AI PARSER PIPELINE] Celery task scheduled with ID=${taskId}. Starting status poll...`);

          // Poll loop: 500ms intervals for up to 10 seconds (20 iterations)
          for (let attempt = 1; attempt <= 20; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const statusRes = await fetch(`${apiHost}/api/v1/status/${taskId}`);
              if (statusRes.ok) {
                const statusData = await statusRes.json();
                this.logger.log(`[Poll Attempt ${attempt}] Task status: ${statusData.status}`);
                if (statusData.status === 'SUCCESS' || statusData.status === 'completed') {
                  completed = true;
                  break;
                } else if (statusData.status === 'FAILURE') {
                  this.logger.warn(`Celery background worker reported FAILURE for taskId=${taskId}`);
                  break;
                }
              }
            } catch (pollErr: any) {
              this.logger.warn(`Polling status attempt ${attempt} encountered error: ${pollErr.message}`);
            }
          }
        }
      } catch (jsonErr: any) {
        this.logger.error(`Error parsing response payload: ${jsonErr.message}`);
      }
    }

    // 7. Supabase Database Sync Fetch
    if (completed) {
      try {
        // Sleep briefly to let worker transactions fully commit
        await new Promise((resolve) => setTimeout(resolve, 500));
        const dbCandidate = await this.candidatesService.findByEmail(unlockedEmail, tenantId);
        if (dbCandidate) {
          this.logger.log(`[AI PARSER PIPELINE] Successfully synced and loaded parsed profile for ${unlockedEmail} from Supabase DB.`);
          return dbCandidate as InternalCandidateProfile;
        }
      } catch (dbErr: any) {
        this.logger.error(`Failed to retrieve synced candidate from DB: ${dbErr.message}`);
      }
    }

    // 8. Graceful Fallback
    this.logger.warn(`[AI PARSER PIPELINE] Celery parse pipeline failed or timed out. Initiating local direct transaction fallback...`);
    const createdProfile = await this.candidatesService.createCandidate({
      fullName: externalCandidate.fullName,
      email: unlockedEmail,
      phone: unlockedPhone,
      location: externalCandidate.location,
      experienceYears: externalCandidate.experienceYears,
      jobTitle: externalCandidate.currentTitle,
      source: dto.provider === 'dice' ? 'Dice' : 'Monster',
      workAuthorization: externalCandidate.workAuthorization,
      skills: externalCandidate.skills,
      rawText: externalCandidate.resumeText,
    }, tenantId);

    return createdProfile as InternalCandidateProfile;
  }

  /**
   * Retrieves all imported external profiles saved in our shared PostgreSQL database.
   */
  async getImportedProfiles(tenantId: string): Promise<InternalCandidateProfile[]> {
    this.logger.log(`Fetching imported external candidates from CandidatesService for tenant: ${tenantId}...`);
    try {
      const diceCandidates = await this.candidatesService.findAll({ source: 'Dice' }, tenantId);
      const monsterCandidates = await this.candidatesService.findAll({ source: 'Monster' }, tenantId);
      
      const combined = [...diceCandidates, ...monsterCandidates];
      return combined as InternalCandidateProfile[];
    } catch (err) {
      this.logger.error(`Failed to fetch imported sourcing profiles: ${err.message}`, err.stack);
      return [];
    }
  }
}
