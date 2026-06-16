import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import * as dns from 'dns';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  async onModuleInit() {
    let connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DATABASE_URL environment variable is missing!');
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Manually resolve hostname to IPv4 to bypass Docker IPv6 ENETUNREACH routing issues
    try {
      const parsedUrl = new URL(connectionString);
      const host = parsedUrl.hostname;
      const lookupResult = await dnsLookup(host, { family: 4 });
      parsedUrl.hostname = lookupResult.address;
      connectionString = parsedUrl.toString();
      this.logger.log(`Resolved database hostname ${host} to IPv4 ${lookupResult.address}`);
    } catch (err) {
      this.logger.warn(`Failed to resolve hostname to IPv4: ${err.message}. Using original connection string.`);
    }

    this.logger.log('Initializing PostgreSQL connection pool...');
    
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    });

    // Test the database connection immediately and ensure tables exist
    try {
      const res = await this.pool.query('SELECT NOW()');
      this.logger.log(`Successfully connected to Supabase database. Server time: ${res.rows[0].now}`);
      await this.ensureTablesExist();
    } catch (err) {
      this.logger.error(`Failed to connect to Supabase database or run migration: ${err.message}`, err.stack);
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing PostgreSQL connection pool...');
    await this.pool.end();
  }

  /**
   * Runs the core SaaS tables migration automatically if they don't already exist.
   */
  private async ensureTablesExist() {
    this.logger.log('Executing database schema checks for tenants, jobs, and recruiter_submissions...');
    
    const ddl = `
      -- 1. Create tenants table
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) UNIQUE,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        default_market VARCHAR(50) DEFAULT 'US',
        user_limit INT DEFAULT 5,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure default_market column exists on older tenants tables
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_market VARCHAR(50) DEFAULT 'US';
      -- Ensure user_limit column exists on older tenants tables
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS user_limit INT DEFAULT 5;

      -- 2. Insert default tenant
      INSERT INTO tenants (id, name, domain, status, default_market, user_limit)
      VALUES ('d3b07384-d113-49c3-a555-9ee75c13ca33', 'Default Enfy SaaS Tenant', 'enfycon.com', 'ACTIVE', 'US', 10)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, default_market = COALESCE(tenants.default_market, 'US'), user_limit = COALESCE(tenants.user_limit, 10);

      -- 3. Create jobs table if not exists (migrating jobs database-backed)
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        job_code VARCHAR(100) UNIQUE NOT NULL,
        job_title VARCHAR(255) NOT NULL,
        job_location VARCHAR(255) NOT NULL,
        job_type VARCHAR(100) NOT NULL DEFAULT 'Full-time',
        job_description TEXT,
        skills_required TEXT[],
        visa_type VARCHAR(100),
        client_bill_rate VARCHAR(100) NOT NULL,
        pay_rate VARCHAR(100) NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        end_client_name VARCHAR(255) NOT NULL,
        no_of_positions INT NOT NULL DEFAULT 1,
        submission_required INT NOT NULL DEFAULT 5,
        submission_done INT NOT NULL DEFAULT 0,
        urgency VARCHAR(50) NOT NULL DEFAULT 'WARM',
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        account_manager_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure columns exist in case table was created before columns were added
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_type VARCHAR(100) NOT NULL DEFAULT 'Full-time';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_description TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills_required TEXT[];
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'US';
      
      -- Ensure account_manager_id is optional (nullable)
      ALTER TABLE jobs ALTER COLUMN account_manager_id DROP NOT NULL;

      -- 4. Add tenant_id column to candidates if not exists
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      
      -- 5. Add market columns to candidates if not exists
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_ctc DECIMAL(10,2);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_ctc DECIMAL(10,2);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS notice_period_days INT DEFAULT 0;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS serving_notice BOOLEAN DEFAULT FALSE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_working_day DATE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pan_card VARCHAR(10);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS preferred_locations VARCHAR(255)[];

      -- 6. Default existing candidates to use the seeded tenant
      UPDATE candidates SET tenant_id = 'd3b07384-d113-49c3-a555-9ee75c13ca33' WHERE tenant_id IS NULL;

      -- 7. Create recruiter_submissions table
      CREATE TABLE IF NOT EXISTS recruiter_submissions (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        candidate_id INT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        recruiter_id VARCHAR(255) NOT NULL,
        l1_status VARCHAR(50) DEFAULT 'PENDING',
        l1_date TIMESTAMP WITH TIME ZONE,
        l2_status VARCHAR(50),
        l2_date TIMESTAMP WITH TIME ZONE,
        l3_status VARCHAR(50),
        l3_date TIMESTAMP WITH TIME ZONE,
        final_status VARCHAR(50) DEFAULT 'SUBMITTED',
        remarks TEXT,
        recruiter_comment TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 8. Create mass_mail schema and tables
      CREATE SCHEMA IF NOT EXISTS mass_mail;

      CREATE TABLE IF NOT EXISTS mass_mail.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        body_template TEXT,
        status VARCHAR(50) DEFAULT 'Draft',
        created_by VARCHAR(255),
        scheduled_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE mass_mail.campaigns ADD COLUMN IF NOT EXISTS rate_per_minute INT DEFAULT 0;
      ALTER TABLE mass_mail.campaigns ADD COLUMN IF NOT EXISTS rate_per_hour INT DEFAULT 0;
      ALTER TABLE mass_mail.campaigns ADD COLUMN IF NOT EXISTS randomize_delay BOOLEAN DEFAULT FALSE;
      ALTER TABLE mass_mail.campaigns ADD COLUMN IF NOT EXISTS email_account_id UUID;

      CREATE TABLE IF NOT EXISTS mass_mail.email_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255),
        provider VARCHAR(50) NOT NULL,
        email_address VARCHAR(255) NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS profile_name VARCHAR(255);
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS password TEXT;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255);
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS smtp_port INT;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS imap_host VARCHAR(255);
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS imap_port INT;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS require_ssl BOOLEAN DEFAULT FALSE;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS require_tls BOOLEAN DEFAULT FALSE;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS mass_mail.email_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        action_name VARCHAR(255) NOT NULL UNIQUE,
        email_account_id UUID REFERENCES mass_mail.email_accounts(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mass_mail.recipients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES mass_mail.campaigns(id) ON DELETE CASCADE,
        candidate_id INT NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        opened_at TIMESTAMP WITH TIME ZONE,
        clicked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE mass_mail.recipients ALTER COLUMN candidate_id DROP NOT NULL;
      ALTER TABLE mass_mail.recipients ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
      ALTER TABLE mass_mail.recipients ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
      ALTER TABLE mass_mail.recipients ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE mass_mail.recipients ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP WITH TIME ZONE;

      CREATE TABLE IF NOT EXISTS mass_mail.templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        body TEXT,
        created_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pending_normalizations (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        raw_value VARCHAR(255) UNIQUE NOT NULL,
        detected_count INT DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      INSERT INTO pending_normalizations (category, raw_value, detected_count)
      VALUES 
        ('SKILL', 'ReactJS', 28),
        ('SKILL', 'AWS Cloud', 15),
        ('SKILL', 'Next.js', 19),
        ('DESIGNATION', 'sde II', 12),
        ('DESIGNATION', 'qa lead', 8),
        ('COMPANY', 'Infosys Ltd', 24),
        ('COMPANY', 'Capgemini India', 9),
        ('LOCATION', 'Herndon, VA', 7),
        ('DEGREE', 'btech', 31),
        ('DEGREE', 'mca', 14)
      ON CONFLICT (raw_value) DO NOTHING;
    `;

    try {
      await this.pool.query(ddl);
      this.logger.log('Database tables successfully checked/created for SaaS multi-tenancy with Indian market enhancements!');
    } catch (err) {
      this.logger.error(`Database schema migration failed: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Runs a query on the database using the connection pool.
   */
  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const res = await this.pool.query<T>(text, params);
      // const duration = Date.now() - start;
      // this.logger.debug(`Executed query: ${text.slice(0, 100)}... in ${duration}ms`);
      return res;
    } catch (error) {
      this.logger.error(`Query error: ${error.message} | Query: ${text}`, error.stack);
      throw error;
    }
  }

  /**
   * Retrieves a client from the pool to run multi-query transactions.
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }
}
