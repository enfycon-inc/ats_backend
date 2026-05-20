import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  onModuleInit() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DATABASE_URL environment variable is missing!');
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.logger.log('Initializing PostgreSQL connection pool with Supabase DATABASE_URL...');
    
    this.pool = new Pool({
      connectionString,
      // For Supabase connection pooling (session/transaction mode), we set reasonable limits
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    });

    // Test the database connection immediately
    this.pool.query('SELECT NOW()')
      .then((res) => {
        this.logger.log(`Successfully connected to Supabase database. Server time: ${res.rows[0].now}`);
      })
      .catch((err) => {
        this.logger.error(`Failed to connect to Supabase database: ${err.message}`, err.stack);
      });
  }

  async onModuleDestroy() {
    this.logger.log('Closing PostgreSQL connection pool...');
    await this.pool.end();
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
