import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  Headers,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { RecruiterSubmissionsService, SubmissionDetails } from './recruiter-submissions.service';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

@ApiTags('ATS Recruiter Submissions & Interview Tracking')
@Controller('api/recruiter-submissions')
export class RecruiterSubmissionsController {
  constructor(private readonly service: RecruiterSubmissionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a Candidate to a Job Opening',
    description: 'Creates a new candidate-to-job submission record with optional L1/L2/L3 scheduling details under tenant isolation.',
  })
  @ApiResponse({ status: 201, description: 'Submission created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid Job ID or Candidate ID.' })
  @ApiResponse({ status: 403, description: 'Job status is not ACTIVE or carrying forward.' })
  async create(
    @Body() dto: CreateSubmissionDto,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<SubmissionDetails> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.create(dto, activeTenantId);
  }

  @Get()
  @ApiOperation({
    summary: 'List & Filter Candidate Submissions',
    description: 'Retrieves all candidate submissions for a specific tenant, supporting custom filters and pagination.',
  })
  @ApiResponse({ status: 200, description: 'Submissions list resolved.' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('l1Status') l1Status?: string,
    @Query('l2Status') l2Status?: string,
    @Query('l3Status') l3Status?: string,
    @Query('finalStatus') finalStatus?: string,
    @Query('jobId') jobId?: string,
    @Query('candidateId') candidateId?: string,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.findAll(activeTenantId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      startDate,
      endDate,
      l1Status,
      l2Status,
      l3Status,
      finalStatus,
      jobId,
      candidateId: candidateId ? parseInt(candidateId, 10) : undefined,
    });
  }

  @Get('tracker-stats')
  @ApiOperation({
    summary: 'Retrieve Recruiter Submissions Tracker Stats',
    description: 'Aggregates total submissions and PENDING status counts for recruiter dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Tracker stats aggregated successfully.' })
  async getTrackerStats(@Headers('x-tenant-id') tenantId?: string) {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.getTrackerStats(activeTenantId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch Detailed Submission Record',
    description: 'Retrieves a single candidate submission profile with joined candidate and job requisition properties.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric serial database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Detailed submission profile resolved successfully.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<SubmissionDetails> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.findOne(id, activeTenantId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Submission Statuses or Interview Schedules',
    description: 'Modifies active interview stages and remarks, automatically evaluating sequential auto-rejections.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric serial database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Submission record successfully updated.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubmissionDto,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<SubmissionDetails> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.update(id, dto, activeTenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete Candidate Submission Record',
    description: 'Removes submission record and decrements submission done counts on the job requisition.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric serial database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Submission removed successfully.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ message: string }> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.service.remove(id, activeTenantId);
  }
}
