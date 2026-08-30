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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { RecruiterSubmissionsService, SubmissionDetails } from './recruiter-submissions.service';
import { CreateSubmissionDto } from './dtos/create-submission.dto';
import { UpdateSubmissionDto } from './dtos/update-submission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';
import { resolveBranchId } from '../auth/utils/branch-resolver';

@ApiTags('ATS Recruiter Submissions & Interview Tracking')
@Controller('api/recruiter-submissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
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
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<SubmissionDetails> {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    return this.service.create(dto, tid, user, bid);
  }

  @Get()
  @ApiOperation({
    summary: 'List & Filter Candidate Submissions',
    description: 'Retrieves all candidate submissions for a specific tenant, supporting custom filters and pagination.',
  })
  @ApiResponse({ status: 200, description: 'Submissions list resolved.' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
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
  ) {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    return this.service.findAll(tid, user, {
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
      branchId: bid || undefined,
    });
  }

  @Get('tracker-stats')
  @ApiOperation({
    summary: 'Retrieve Recruiter Submissions Tracker Stats',
    description: 'Aggregates total submissions and PENDING status counts for recruiter dashboard.',
  })
  @ApiResponse({ status: 200, description: 'Tracker stats aggregated successfully.' })
  async getTrackerStats(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.service.getTrackerStats(tid, user);
  }

  @Get('custom-remarks')
  @ApiOperation({
    summary: 'List Tenant & Branch Custom Stage Remarks Templates',
    description: 'Retrieves all custom stage remarks configured for the active tenant and optional branch.',
  })
  async getCustomRemarks(
    @Query('branchId') branchId: string,
    @Query('includeGlobal') includeGlobal: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const parsedIncludeGlobal = includeGlobal !== undefined ? includeGlobal === 'true' || includeGlobal === '1' : undefined;
    return this.service.getCustomRemarks(tid, branchId, parsedIncludeGlobal);
  }

  @Post('custom-remarks')
  @ApiOperation({
    summary: 'Create a Tenant or Branch Custom Stage Remark Template',
    description: 'Adds a custom stage remark option for review, L1, L2, L3, or final stage.',
  })
  async createCustomRemark(
    @Body() body: { stage: string; remarkText: string; remarkType?: string; branchId?: string; isGlobal?: boolean },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.service.createCustomRemark(
      tid,
      body.stage,
      body.remarkText,
      body.remarkType || 'GENERAL',
      body.branchId,
      user.email || user.fullName || user.dbId,
      body.isGlobal
    );
  }

  @Delete('custom-remarks/:id')
  @ApiOperation({
    summary: 'Delete a Tenant Custom Stage Remark Template',
    description: 'Removes a custom remark template by ID.',
  })
  async deleteCustomRemark(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.service.deleteCustomRemark(tid, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch Single Candidate Submission Details',
    description: 'Returns candidate submission payload along with matched JD details.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Detailed submission profile resolved successfully.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<SubmissionDetails> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.findOne(id, tid);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Submission Statuses or Interview Schedules',
    description: 'Modifies active interview stages and remarks, automatically evaluating sequential auto-rejections.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Submission record successfully updated.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubmissionDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<SubmissionDetails> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.update(id, dto, tid, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete Candidate Submission Record',
    description: 'Removes submission record and decrements submission done counts on the job requisition.',
  })
  @ApiParam({ name: 'id', description: 'Alphanumeric database primary key of the submission', type: Number })
  @ApiResponse({ status: 200, description: 'Submission removed successfully.' })
  @ApiResponse({ status: 404, description: 'Submission not found.' })
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ message: string }> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.remove(id, tid);
  }
}
