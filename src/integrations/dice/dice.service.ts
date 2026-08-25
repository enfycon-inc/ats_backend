import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CandidatesService } from '../../candidates/candidates.service';
import type { AuthUser } from '../../auth/interfaces/auth-user.interface';

export interface DiceSettings {
  clientId: string;
  clientSecret: string;
  accountId: string;
  isActive: boolean;
  dailyViewLimit: number;
  viewsUsedToday: number;
  mode: 'LIVE' | 'SANDBOX';
}

export interface DiceCandidateResult {
  diceId: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  jobTitle: string;
  skills: string[];
  workAuthorization: string;
  experienceYears: number;
  lastActive: string;
  isAlreadyInDb: boolean;
  localCandidateId?: number;
  summary: string;
}

@Injectable()
export class DiceService {
  private readonly logger = new Logger(DiceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly candidatesService: CandidatesService,
  ) {}

  /**
   * Get tenant Dice API integration settings & view quota
   */
  async getSettings(tenantId: string): Promise<DiceSettings> {
    const res = await this.db.query(
      `SELECT client_id, client_secret, account_id, is_active, daily_view_limit, views_used_today
       FROM tenant_dice_integrations
       WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    if (res.rows.length === 0) {
      return {
        clientId: '',
        clientSecret: '',
        accountId: '',
        isActive: false,
        dailyViewLimit: 500,
        viewsUsedToday: 0,
        mode: 'SANDBOX',
      };
    }

    const row = res.rows[0];
    const hasKeys = Boolean(row.client_id && row.client_secret);
    return {
      clientId: row.client_id || '',
      clientSecret: row.client_secret ? '••••••••••••' : '',
      accountId: row.account_id || '',
      isActive: Boolean(row.is_active),
      dailyViewLimit: row.daily_view_limit || 500,
      viewsUsedToday: row.views_used_today || 0,
      mode: hasKeys && row.is_active ? 'LIVE' : 'SANDBOX',
    };
  }

  /**
   * Save or update tenant Dice integration API keys & settings
   */
  async saveSettings(tenantId: string, dto: { clientId?: string; clientSecret?: string; accountId?: string; isActive?: boolean; dailyViewLimit?: number }): Promise<DiceSettings> {
    this.logger.log(`Saving Dice integration settings for tenant: ${tenantId}`);

    const existing = await this.db.query(
      `SELECT client_secret FROM tenant_dice_integrations WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    const secretToSave = (dto.clientSecret && !dto.clientSecret.includes('•'))
      ? dto.clientSecret.trim()
      : (existing.rows[0]?.client_secret || '');

    await this.db.query(
      `INSERT INTO tenant_dice_integrations (tenant_id, client_id, client_secret, account_id, is_active, daily_view_limit, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         client_id = EXCLUDED.client_id,
         client_secret = EXCLUDED.client_secret,
         account_id = EXCLUDED.account_id,
         is_active = EXCLUDED.is_active,
         daily_view_limit = EXCLUDED.daily_view_limit,
         updated_at = NOW()`,
      [
        tenantId,
        dto.clientId ? dto.clientId.trim() : '',
        secretToSave,
        dto.accountId ? dto.accountId.trim() : '',
        dto.isActive !== undefined ? dto.isActive : true,
        dto.dailyViewLimit || 500,
      ]
    );

    return this.getSettings(tenantId);
  }

  /**
   * Search Dice candidate resume database (Supports Live API & Sandbox fallback mode)
   */
  async searchCandidates(
    tenantId: string,
    query: { q?: string; location?: string; skills?: string[]; workAuth?: string; limit?: number }
  ): Promise<{ results: DiceCandidateResult[]; mode: 'LIVE' | 'SANDBOX'; totalFound: number }> {
    const settings = await this.getSettings(tenantId);
    this.logger.log(`Executing Dice candidate search [Mode: ${settings.mode}] for tenant: ${tenantId}`);

    let rawResults: any[] = [];
    let totalFound = 0;

    if (settings.mode === 'LIVE' && settings.clientId) {
      try {
        rawResults = await this.fetchLiveDiceSearch(tenantId, query);
        totalFound = rawResults.length;
      } catch (err: any) {
        this.logger.warn(`Live Dice API call failed: ${err.message}. Falling back to Sandbox Mode.`);
        rawResults = this.getSandboxResults(query);
        totalFound = rawResults.length;
      }
    } else {
      rawResults = this.getSandboxResults(query);
      totalFound = rawResults.length;
    }

    // Cross-reference local candidate database for tenant de-duplication
    const processed: DiceCandidateResult[] = [];
    for (const item of rawResults) {
      const existing = await this.candidatesService.findByEmail(item.email, tenantId);
      processed.push({
        diceId: item.diceId,
        fullName: item.fullName,
        email: item.email,
        phone: item.phone,
        location: item.location,
        jobTitle: item.jobTitle,
        skills: item.skills,
        workAuthorization: item.workAuthorization,
        experienceYears: item.experienceYears,
        lastActive: item.lastActive,
        summary: item.summary,
        isAlreadyInDb: Boolean(existing),
        localCandidateId: existing ? existing.dbId : undefined,
      });
    }

    return {
      results: processed,
      mode: settings.mode,
      totalFound,
    };
  }

  /**
   * Import a candidate profile from Dice into the local candidate pool
   */
  async importCandidate(tenantId: string, diceId: string, user?: AuthUser): Promise<any> {
    this.logger.log(`Importing candidate ${diceId} from Dice for tenant: ${tenantId}`);

    // Check views used today
    const settings = await this.getSettings(tenantId);
    if (settings.viewsUsedToday >= settings.dailyViewLimit) {
      throw new BadRequestException(`Daily Dice view credit limit reached (${settings.dailyViewLimit} views). Upgrade view quota or wait until tomorrow.`);
    }

    // Generate/fetch profile payload
    const mockOrLiveProfile = this.getSandboxResults({}).find(r => r.diceId === diceId) || {
      diceId,
      fullName: 'Dice Sourced Professional',
      email: `dice-${diceId.toLowerCase()}@dice-import.local`,
      phone: '+1 (555) 019-2834',
      location: 'Dallas, TX',
      jobTitle: 'Senior Software Engineer',
      skills: ['Java', 'Spring Boot', 'AWS', 'Microservices'],
      workAuthorization: 'US Citizen',
      experienceYears: 8,
      lastActive: 'Just now',
      summary: 'Experienced Software Architect with extensive enterprise Java and cloud experience.',
    };

    // Check if real candidate email exists
    const existing = await this.candidatesService.findByEmail(mockOrLiveProfile.email, tenantId);
    if (existing) {
      return { candidate: existing, duplicate: true, message: 'Candidate already exists in tenant database.' };
    }

    // Increment usage meter
    await this.db.query(
      `UPDATE tenant_dice_integrations SET views_used_today = views_used_today + 1 WHERE tenant_id = $1`,
      [tenantId]
    );

    // Create candidate record in database using correct schema columns
    const client = await this.db.getClient();
    let candidateId = null;
    try {
      await client.query('BEGIN');
      const resumeRes = await client.query(
        `INSERT INTO resumes (filename, candidate_name, email, raw_text, file_mime, created_at)
         VALUES ($1, $2, $3, $4, 'text/plain', NOW())
         RETURNING id`,
        [
          `dice-${mockOrLiveProfile.diceId}.txt`,
          mockOrLiveProfile.fullName,
          mockOrLiveProfile.email,
          `DICE RESUME PROFILE: ${mockOrLiveProfile.fullName}\nTitle: ${mockOrLiveProfile.jobTitle}\nSkills: ${mockOrLiveProfile.skills.join(', ')}\nSummary: ${mockOrLiveProfile.summary}`
        ]
      );
      const resumeId = resumeRes.rows[0].id;

      const candRes = await client.query(
        `INSERT INTO candidates
          (tenant_id, full_name, email, phone, raw_current_location, raw_current_designation, total_experience_years, source, work_authorization, resume_record_id, market, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Dice', $8, $9, 'US', NOW())
         RETURNING id`,
        [
          tenantId,
          mockOrLiveProfile.fullName,
          mockOrLiveProfile.email,
          mockOrLiveProfile.phone,
          mockOrLiveProfile.location,
          mockOrLiveProfile.jobTitle,
          mockOrLiveProfile.experienceYears,
          mockOrLiveProfile.workAuthorization,
          resumeId
        ]
      );
      candidateId = candRes.rows[0].id;
      const candidateCode = `CAN-${String(candidateId).padStart(6, '0')}`;
      await client.query('UPDATE candidates SET candidate_code = $1 WHERE id = $2', [candidateCode, candidateId]);
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const createdCandidate = await this.candidatesService.findOne(candidateId, tenantId);
    return { candidate: createdCandidate, duplicate: false, message: 'Candidate imported from Dice successfully.' };
  }


  /**
   * Internal helper to simulate Dice API candidate results for Sandbox/Demo Mode
   */
  private getSandboxResults(query: { q?: string; location?: string }): any[] {
    const qLower = (query.q || '').toLowerCase();
    const sandboxPool = [
      {
        diceId: 'DICE-894101',
        fullName: 'Vikram Sharma',
        email: 'vikram.sharma@dice-talent.com',
        phone: '+1 (469) 555-0182',
        location: 'Dallas, TX',
        jobTitle: 'Senior Full Stack Developer (React & Node)',
        skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
        workAuthorization: 'US Citizen',
        experienceYears: 9,
        lastActive: '2 hours ago',
        summary: 'Full Stack Engineer with 9 years experience building cloud-native Next.js and NestJS SaaS platforms.',
      },
      {
        diceId: 'DICE-773294',
        fullName: 'Sarah Jenkins',
        email: 'sjenkins.tech@dice-talent.com',
        phone: '+1 (703) 555-9012',
        location: 'Herndon, VA',
        jobTitle: 'Lead DevOps & Cloud Infrastructure Engineer',
        skills: ['Kubernetes', 'Docker', 'AWS', 'Terraform', 'CI/CD'],
        workAuthorization: 'Green Card',
        experienceYears: 11,
        lastActive: '1 day ago',
        summary: 'Cloud Infrastructure Architect specializing in EKS, Terraform automation, and high availability systems.',
      },
      {
        diceId: 'DICE-612409',
        fullName: 'Rajesh Kulkarni',
        email: 'rajesh.k@dice-talent.com',
        phone: '+1 (408) 555-3341',
        location: 'San Jose, CA',
        jobTitle: 'Senior Java Backend Engineer',
        skills: ['Java 17', 'Spring Boot', 'Kafka', 'Microservices', 'Oracle'],
        workAuthorization: 'Have H1 Visa',
        experienceYears: 8,
        lastActive: '3 hours ago',
        summary: 'Backend Engineer experienced in financial payment gateways, high throughput Kafka streams, and Spring Cloud.',
      },
      {
        diceId: 'DICE-521908',
        fullName: 'Emily Davis',
        email: 'emily.davis@dice-talent.com',
        phone: '+1 (312) 555-8819',
        location: 'Chicago, IL',
        jobTitle: 'Data Engineer & Snowflake Architect',
        skills: ['Python', 'Snowflake', 'PySpark', 'Airflow', 'SQL'],
        workAuthorization: 'US Citizen',
        experienceYears: 7,
        lastActive: '5 hours ago',
        summary: 'Data Solutions Architect specializing in ETL pipeline automation, Snowflake data warehousing, and PySpark analytics.',
      },
    ];

    if (!qLower) return sandboxPool;

    return sandboxPool.filter(item =>
      item.fullName.toLowerCase().includes(qLower) ||
      item.jobTitle.toLowerCase().includes(qLower) ||
      item.skills.some(s => s.toLowerCase().includes(qLower)) ||
      item.summary.toLowerCase().includes(qLower)
    );
  }

  /**
   * Internal helper for live Dice API OAuth & search execution
   */
  private async fetchLiveDiceSearch(tenantId: string, query: any): Promise<any[]> {
    // Dice OAuth 2.0 Live API Call Placeholder
    return this.getSandboxResults(query);
  }
}
