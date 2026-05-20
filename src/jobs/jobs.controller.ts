import { Controller, Get, Post, Body, Param, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { JobsService, JobProfile } from './jobs.service';
import { CreateJobDto } from './dtos/create-job.dto';

@ApiTags('ATS Job Openings & Requirements')
@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create New Job Requisition',
    description: 'Creates a new client job opening, defining mandatory skills and employment models.',
  })
  @ApiResponse({ status: 201, description: 'Job requisition created successfully.' })
  async create(@Body() dto: CreateJobDto): Promise<JobProfile> {
    return this.jobsService.createJob(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Retrieve List of All Job Openings',
    description: 'Lists all client vacancies and requisitions configured in the system.',
  })
  @ApiResponse({ status: 200, description: 'List of job vacancies fetched successfully.' })
  async findAll(): Promise<JobProfile[]> {
    return this.jobsService.findAllJobs();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Detailed Job Openings Profile',
    description: 'Retrieves job description, client specifications, and required technical stacks by job ID.',
  })
  @ApiParam({ name: 'id', description: 'The unique alphanumeric ID of the Job requisition', type: String })
  @ApiResponse({ status: 200, description: 'Job profile resolved successfully.' })
  @ApiResponse({ status: 404, description: 'Job requisition not found.' })
  async findOne(@Param('id') id: string): Promise<JobProfile> {
    return this.jobsService.findOneJob(id);
  }
}
