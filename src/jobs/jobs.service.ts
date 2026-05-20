import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateJobDto } from './dtos/create-job.dto';

export interface JobProfile {
  id: string;
  title: string;
  client: string;
  location: string;
  type: string;
  description: string;
  skillsRequired: string[];
  status: string;
  createdOn: string;
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  // In-memory list representing active job openings in the system
  private readonly jobsList: Map<string, JobProfile> = new Map([
    [
      'JOB-4811',
      {
        id: 'JOB-4811',
        title: 'Snowflake Data Engineer',
        client: 'Deloitte',
        location: 'Johns Creek, GA',
        type: 'Contract',
        description: 'Seeking a senior Snowflake database warehouse designer...',
        skillsRequired: ['Snowflake', 'dbt', 'SQL', 'Data Warehousing', 'Python'],
        status: 'Active',
        createdOn: new Date().toISOString(),
      },
    ],
    [
      'JOB-4812',
      {
        id: 'JOB-4812',
        title: 'Email Security Specialist',
        client: 'IronBow Technologies',
        location: 'Herndon, VA',
        type: 'Full-time',
        description: 'Looking for a specialist to coordinate Proofpoint and cloud tenant protections...',
        skillsRequired: ['Email Security', 'Proofpoint', 'Cybersecurity', 'Office 365'],
        status: 'Active',
        createdOn: new Date().toISOString(),
      },
    ],
  ]);

  /**
   * Directly creates a new job vacancy requirement record
   */
  async createJob(dto: CreateJobDto): Promise<JobProfile> {
    this.logger.log(`Creating job requisition: ${dto.title} for client: ${dto.client}`);
    
    const jobId = `JOB-${Math.floor(1000 + Math.random() * 9000)}`;
    const newJob: JobProfile = {
      id: jobId,
      title: dto.title,
      client: dto.client,
      location: dto.location,
      type: dto.type,
      description: dto.description,
      skillsRequired: dto.skillsRequired,
      status: dto.status,
      createdOn: new Date().toISOString(),
    };

    this.jobsList.set(jobId, newJob);
    return newJob;
  }

  /**
   * Retrieves all job openings in the system
   */
  async findAllJobs(): Promise<JobProfile[]> {
    this.logger.log('Fetching active job lists.');
    return Array.from(this.jobsList.values());
  }

  /**
   * Retrieves detail of a single job opening
   */
  async findOneJob(id: string): Promise<JobProfile> {
    this.logger.log(`Fetching job detail for ID=${id}`);
    
    const job = this.jobsList.get(id);
    if (!job) {
      throw new NotFoundException(`Job requisition ${id} was not found.`);
    }

    return job;
  }
}
