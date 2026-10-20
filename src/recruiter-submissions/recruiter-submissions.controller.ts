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
  ParseUUIDPipe,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
  UseGuards,
  ForbiddenException,
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
import type { TrackerBucket } from './tracker-contract';

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
    @Query('view') view?: string,
    @Query('search') search?: string,
    @Query('bucket') bucket?: TrackerBucket,
    @Query('sortBy') sortBy?: string,
    @Query('sortDirection') sortDirection?: string,
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
      candidateId: candidateId ? candidateId : undefined,
      branchId: bid || undefined,
      view,
      search,
      bucket,
      sortBy,
      sortDirection,
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
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('view') view?: string,
    @Query('rangeDays') rangeDays?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    const parsedRange = rangeDays ? Number(rangeDays) : undefined;
    return this.service.getTrackerStats(tid, user, { view, branchId: bid || undefined, rangeDays: parsedRange });
  }

  @Get('calendar-events')
  @ApiOperation({ summary: 'List interview events visible in the authenticated user’s submission scope' })
  async calendarEvents(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    return this.service.findCalendarEvents(tid, user, bid, start, end);
  }

  @Get('eligible-for-interview')
  @ApiOperation({ summary: 'List visible submissions that can be scheduled for their next interview round' })
  async eligibleForInterview(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('view') view?: string,
    @Query('search') search?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    if (!(user.permissions || []).some(permission => ['*', 'submission:schedule_interview'].includes(permission))) {
      throw new ForbiddenException('Missing submission:schedule_interview permission.');
    }
    return this.service.findEligibleForInterview(tid, user, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
      branchId: bid || undefined,
      view: view || undefined,
      search,
    });
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
    const tenantManager = user.permissions?.some(p => ['tenant:settings', 'tenant:manage', 'platform:manage'].includes(p));
    if (!tenantManager) {
      // Allow cross-branch template viewing for co-sourced jobs
        // if (branchId && branchId !== user.branchId) throw new ForbiddenException('You can only view remarks for your assigned branch.');
      if (!branchId && parsedIncludeGlobal !== true) {
        if (!user.branchId) throw new ForbiddenException('No branch is assigned to your account.');
        branchId = user.branchId;
      }
    }
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
      body.isGlobal,
      user,
    );
  }

  @Delete('custom-remarks/:id')
  @ApiOperation({
    summary: 'Delete a Tenant Custom Stage Remark Template',
    description: 'Removes a custom remark template by ID. Global templates can only be deleted by Global Administrators.',
  })
  async deleteCustomRemark(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId);
    return this.service.deleteCustomRemark(tid, id, user);
  }

  @Get(':id/history')
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('page') page?: string,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    return this.service.history(id, resolveTenantId(user, tenantId), user, resolveBranchId(user, branchHeaderId), page === undefined ? 1 : Number(page), order);
  }

  @Get(':id/assessment')
  async assessment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ) {
    return this.service.assessment(id, resolveTenantId(user, tenantId), user, resolveBranchId(user, branchHeaderId));
  }

  @Get(':id/people/:kind')
  @ApiOperation({ summary: 'Get a team member profile related to a visible submission' })
  async relatedPersonProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind') kind: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ) {
    if (kind !== 'recruiter' && kind !== 'account-manager') throw new ForbiddenException('Unsupported submission profile type.');
    const tid = resolveTenantId(user, tenantId);
    return this.service.relatedPersonProfile(id, kind, tid, user, resolveBranchId(user, branchHeaderId));
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<SubmissionDetails> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.findOne(id, tid, user, resolveBranchId(user, branchHeaderId));
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubmissionDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<SubmissionDetails> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.update(id, dto, tid, user, resolveBranchId(user, branchHeaderId));
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
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ message: string }> {
    const tid = resolveTenantId(user, tenantId);
    return this.service.remove(id, tid);
  }
}
