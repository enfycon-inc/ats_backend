import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  async onModuleInit() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DATABASE_URL environment variable is missing!');
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.logger.log('Initializing PostgreSQL connection pool with Supabase DATABASE_URL...');
    
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Ensure default_market column exists on older tenants tables
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS default_market VARCHAR(50) DEFAULT 'US';

      -- 2. Insert default tenant
      INSERT INTO tenants (id, name, domain, status, default_market)
      VALUES ('d3b07384-d113-49c3-a555-9ee75c13ca33', 'Default Enfy SaaS Tenant', 'enfycon.com', 'ACTIVE', 'US')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, default_market = COALESCE(tenants.default_market, 'US');

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
      const duration = Date.now() - start;
      this.logger.debug(`Executed query: ${text.slice(0, 100)}... in ${duration}ms`);
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
