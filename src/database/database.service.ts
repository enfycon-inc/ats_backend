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

    // Catch background connection drops / resets so unhandled 'error' events do not crash NestJS process
    this.pool.on('error', (err) => {
      this.logger.error(`Unexpected background PostgreSQL pool client error: ${err.message}`, err.stack);
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
      -- Ensure prefix_code column exists for unique ID generation
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS prefix_code VARCHAR(10) UNIQUE;
      -- Ensure pod_system_enabled column exists on tenants
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pod_system_enabled BOOLEAN DEFAULT TRUE;
      -- Ensure max_branches column exists on tenants (DEFAULT 5)
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_branches INT DEFAULT 5;
      -- Ensure candidate_pool_mode column exists on tenants (DEFAULT 'COMBINED_MARKET')
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS candidate_pool_mode VARCHAR(50) DEFAULT 'COMBINED_MARKET';
      -- Ensure multi-tenant email dispatch strategy columns exist on tenants
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email_dispatch_mode VARCHAR(50) DEFAULT 'DEFAULT_SUBDOMAIN';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_email_domain VARCHAR(255);
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_email_domain_verified BOOLEAN DEFAULT FALSE;

      -- 1.5 Create branches table
      CREATE TABLE IF NOT EXISTS branches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100) DEFAULT 'India',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, name)
      );
      -- Ensure manager_id and market columns exist on branches
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_id UUID;
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'INDIA';

      -- 1.6 Create business_units table
      CREATE TABLE IF NOT EXISTS business_units (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50),
        market VARCHAR(50) DEFAULT 'US',
        currency VARCHAR(10) DEFAULT 'USD',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, name)
      );

      -- Add branch_id and business_unit_id columns to jobs
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

      -- Add branch_id and business_unit_id columns to candidates
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

      -- Add branch_id and business_unit_id columns to clients
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id) ON DELETE SET NULL;

      -- 2. Insert default tenant
      INSERT INTO tenants (id, name, domain, status, default_market, user_limit, prefix_code)
      VALUES ('d3b07384-d113-49c3-a555-9ee75c13ca33', 'Default Enfy SaaS Tenant', 'enfycon.com', 'ACTIVE', 'US', 10, 'ENFY')
      ON CONFLICT (id) DO UPDATE SET 
        name = EXCLUDED.name, 
        default_market = COALESCE(tenants.default_market, 'US'), 
        user_limit = COALESCE(tenants.user_limit, 10),
        prefix_code = COALESCE(tenants.prefix_code, 'ENFY');

      -- 2.5 Create tenant counters table
      CREATE TABLE IF NOT EXISTS tenant_counters (
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        entity_type VARCHAR(50) NOT NULL,
        current_value INT DEFAULT 0,
        PRIMARY KEY (tenant_id, entity_type)
      );

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
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS end_client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
      
      -- Ensure account_manager_id is optional (nullable)
      ALTER TABLE jobs ALTER COLUMN account_manager_id DROP NOT NULL;


      -- 4. Add tenant_id column to candidates if not exists
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      
      -- 5. Add market columns to candidates if not exists
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'US';
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS current_ctc DECIMAL(10,2);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS expected_ctc DECIMAL(10,2);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS notice_period_days INT DEFAULT 0;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS serving_notice BOOLEAN DEFAULT FALSE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS last_working_day DATE;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS pan_card VARCHAR(10);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS preferred_locations VARCHAR(255)[];
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_code VARCHAR(100);
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS uploaded_by_name VARCHAR(255);

      -- Backfill candidate_code for existing records
      UPDATE candidates SET candidate_code = 'CAN-' || LPAD(id::text, 6, '0') WHERE candidate_code IS NULL;

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

      -- Add stage-specific interviewer names and comments for multi-stage workflow
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS pod_lead_remarks TEXT;
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS review_feedback TEXT;
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l1_remarks TEXT;
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l1_interviewer VARCHAR(255);
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l2_remarks TEXT;
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l2_interviewer VARCHAR(255);
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l3_remarks TEXT;
      ALTER TABLE recruiter_submissions ADD COLUMN IF NOT EXISTS l3_interviewer VARCHAR(255);

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
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;
      UPDATE mass_mail.email_accounts SET tenant_id = 'd3b07384-d113-49c3-a555-9ee75c13ca33' WHERE tenant_id IS NULL;
      
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS shared_with_all BOOLEAN DEFAULT false;
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS shared_with_branches UUID[] DEFAULT '{}';
      ALTER TABLE mass_mail.email_accounts ADD COLUMN IF NOT EXISTS shared_with_users UUID[] DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS mass_mail.email_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
        action_name VARCHAR(255) NOT NULL UNIQUE,
        email_account_id UUID REFERENCES mass_mail.email_accounts(id) ON DELETE SET NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mass_mail.delivery_settings (
        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
        branch_id VARCHAR(255) NOT NULL DEFAULT 'default',
        rate_per_minute INT NOT NULL DEFAULT 30,
        rate_per_hour INT NOT NULL DEFAULT 500,
        randomize_delay BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (tenant_id, branch_id)
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

      -- 9. Create tenant_domains table to map multiple domains/subdomains to a tenant
      CREATE TABLE IF NOT EXISTS tenant_domains (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        domain_name VARCHAR(255) UNIQUE NOT NULL,
        is_primary BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS verification_token VARCHAR(255);
      ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'VERIFIED';
      ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS ssl_status VARCHAR(50) DEFAULT 'ACTIVE';
      ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

      -- Seed the default tenant domain
      INSERT INTO tenant_domains (tenant_id, domain_name, is_primary, verification_status, ssl_status)
      VALUES ('d3b07384-d113-49c3-a555-9ee75c13ca33', 'enfycon.com', TRUE, 'VERIFIED', 'ACTIVE')
      ON CONFLICT (domain_name) DO NOTHING;

      -- Backfill existing tenants' default subdomain slugs into tenant_domains table
      INSERT INTO tenant_domains (tenant_id, domain_name, is_primary, verification_status, ssl_status)
      SELECT id, domain, TRUE, 'VERIFIED', 'ACTIVE'
      FROM tenants
      WHERE domain IS NOT NULL AND domain <> '' AND domain <> 'enfycon.com'
      ON CONFLICT (domain_name) DO NOTHING;

      -- 9.5 Create tenant_auth_settings table for configurable auth policies
      CREATE TABLE IF NOT EXISTS tenant_auth_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        allow_password_login BOOLEAN DEFAULT TRUE,
        allow_microsoft_sso BOOLEAN DEFAULT FALSE,
        allow_google_sso BOOLEAN DEFAULT FALSE,
        enforce_sso_only BOOLEAN DEFAULT FALSE,
        require_mfa BOOLEAN DEFAULT FALSE,
        allow_personal_emails BOOLEAN DEFAULT TRUE,
        allowed_email_domains TEXT[] DEFAULT '{}',
        microsoft_tenant_id VARCHAR(255),
        microsoft_client_id VARCHAR(255),
        microsoft_client_secret VARCHAR(255),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      ALTER TABLE tenant_auth_settings ADD COLUMN IF NOT EXISTS allow_personal_emails BOOLEAN DEFAULT TRUE;
      ALTER TABLE tenant_auth_settings ADD COLUMN IF NOT EXISTS microsoft_tenant_id VARCHAR(255);

      -- 9.6 Create tenant_email_domains table for custom transactional/outreach email senders
      CREATE TABLE IF NOT EXISTS tenant_email_domains (
        id SERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email_domain VARCHAR(255) UNIQUE NOT NULL,
        sender_address VARCHAR(255) NOT NULL,
        dkim_tokens TEXT[] DEFAULT '{}',
        dkim_verified BOOLEAN DEFAULT FALSE,
        spf_verified BOOLEAN DEFAULT FALSE,
        status VARCHAR(50) DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        verified_at TIMESTAMP WITH TIME ZONE
      );

      -- 9.7 Create user_invitations table for secure invitation & onboarding lifecycle
      CREATE TABLE IF NOT EXISTS user_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        full_name VARCHAR(255),
        role_id UUID REFERENCES custom_roles(id) ON DELETE SET NULL,
        system_role VARCHAR(50) DEFAULT 'RECRUITER',
        branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
        pod_id UUID REFERENCES pods(id) ON DELETE SET NULL,
        invitation_token VARCHAR(255) UNIQUE NOT NULL,
        token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_by VARCHAR(255),
        is_accepted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, email)
      );

      -- 10. Create clients table
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        client_code VARCHAR(100),
        client_name VARCHAR(255) NOT NULL,
        contact_number VARCHAR(100),
        website VARCHAR(255),
        industry VARCHAR(100),
        state VARCHAR(100),
        city VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Active',
        category VARCHAR(100),
        primary_owner VARCHAR(255),
        business_unit VARCHAR(100),
        ownership VARCHAR(100),
        display_on_job_posting BOOLEAN DEFAULT TRUE,
        created_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        federal_id VARCHAR(100),
        email_id VARCHAR(255),
        fax VARCHAR(100),
        payment_terms VARCHAR(100),
        address TEXT,
        client_lead VARCHAR(255),
        postal_code VARCHAR(50),
        country VARCHAR(100),
        practice VARCHAR(100),
        required_documents TEXT,
        tag VARCHAR(100),
        client_short_name VARCHAR(100),
        modified_by VARCHAR(255),
        geopolitical_zone VARCHAR(100),
        primary_business_unit VARCHAR(100),
        facility_management VARCHAR(100)
      );
      
      -- ensure unique client_code per tenant
      ALTER TABLE clients DROP CONSTRAINT IF EXISTS unique_client_code_per_tenant;
      ALTER TABLE clients ADD CONSTRAINT unique_client_code_per_tenant UNIQUE (tenant_id, client_code);

      -- Ensure extended fields exist on clients table
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS branch_id UUID DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'US';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS end_client_name VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_same_as_primary BOOLEAN DEFAULT TRUE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_designation VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS gstin VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan_number VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'USD';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tier_rating VARCHAR(20);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_check_status VARCHAR(50);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS fillability_score NUMERIC(5,2);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS vetting_notes TEXT;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(50) DEFAULT 'ACTIVE';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS msa_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS sow_executed BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS coi_received BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS vendor_portal_created BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS stop_notifications BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS about_company TEXT;

      -- 11. Create pods table
      CREATE TABLE IF NOT EXISTS pods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        pod_head_id UUID,
        description TEXT,
        is_available_for_assignment BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, name)
      );

      ALTER TABLE pods ADD COLUMN IF NOT EXISTS description TEXT;

      -- 12. Add pod_id to users referencing pods
      ALTER TABLE users ADD COLUMN IF NOT EXISTS pod_id UUID REFERENCES pods(id) ON DELETE SET NULL;

      -- Add foreign key constraint to pods.pod_head_id referencing users(id) ON DELETE SET NULL
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_pods_pod_head' AND table_name = 'pods'
        ) THEN
          ALTER TABLE pods ADD CONSTRAINT fk_pods_pod_head FOREIGN KEY (pod_head_id) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;

      -- 13. Create job_pods junction table
      CREATE TABLE IF NOT EXISTS job_pods (
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        pod_id UUID NOT NULL REFERENCES pods(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (job_id, pod_id)
      );

      -- 14. Create job_assignment_logs table
      CREATE TABLE IF NOT EXISTS job_assignment_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        pod_id UUID REFERENCES pods(id) ON DELETE SET NULL,
        assigned_by VARCHAR(255) DEFAULT 'System',
        assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 15. Create bulk_uploads and bulk_upload_items tables
      CREATE TABLE IF NOT EXISTS bulk_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_by VARCHAR(255) NOT NULL,
        total_files INT NOT NULL DEFAULT 0,
        processed_files INT NOT NULL DEFAULT 0,
        failed_files INT NOT NULL DEFAULT 0,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bulk_upload_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bulk_upload_id UUID NOT NULL REFERENCES bulk_uploads(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'queued',
        error_message TEXT,
        candidate_id INT REFERENCES candidates(id) ON DELETE SET NULL,
        candidate_name VARCHAR(255),
        candidate_email VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 16. Create audit_logs table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        actor_id VARCHAR(255) NOT NULL,
        actor_email VARCHAR(255),
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(100),
        target_id VARCHAR(255),
        details JSONB DEFAULT '{}'::jsonb,
        ip_address VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 17. Soft delete columns and performance indexes
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

      CREATE INDEX IF NOT EXISTS idx_jobs_tenant_deleted ON jobs(tenant_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_deleted ON clients(tenant_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_candidates_tenant_deleted ON candidates(tenant_id, deleted_at);

      -- 18. Create tenant_dice_integrations table
      CREATE TABLE IF NOT EXISTS tenant_dice_integrations (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        client_id VARCHAR(255),
        client_secret TEXT,
        account_id VARCHAR(255),
        access_token TEXT,
        token_expires_at TIMESTAMP WITH TIME ZONE,
        is_active BOOLEAN DEFAULT TRUE,
        daily_view_limit INT DEFAULT 500,
        views_used_today INT DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- 19. Client CRM, Qualifier & Onboarding columns
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS market VARCHAR(50) DEFAULT 'US';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS end_client_name VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_same_as_primary BOOLEAN DEFAULT TRUE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_designation VARCHAR(255);
      
      -- Domestic & US Tax Fields
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS gstin VARCHAR(100);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS pan_number VARCHAR(100);
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS currency VARCHAR(20) DEFAULT 'USD';
      
      -- Qualifier & Vetting Columns
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS tier_rating VARCHAR(50) DEFAULT 'TIER_1';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_check_status VARCHAR(50) DEFAULT 'APPROVED';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS fillability_score VARCHAR(50) DEFAULT 'HIGH';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS vetting_notes TEXT;
      
      -- Onboarding Checklist Columns
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS onboarding_status VARCHAR(50) DEFAULT 'ACTIVE';
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS msa_signed BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS sow_executed BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS coi_received BOOLEAN DEFAULT FALSE;
      ALTER TABLE clients ADD COLUMN IF NOT EXISTS vendor_portal_created BOOLEAN DEFAULT FALSE;
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
