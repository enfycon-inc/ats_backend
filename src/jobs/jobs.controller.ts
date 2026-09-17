import {
  Controller, Get, Post, Patch, Delete, Body, Param, Headers, Query,
  HttpStatus, HttpCode, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth,
} from '@nestjs/swagger';
import { JobsService, JobProfile, CandidateMatch } from './jobs.service';
import { CreateJobDto } from './dtos/create-job.dto';
import { DelegateJobDto, AcceptDelegationDto, RejectDelegationDto } from './dtos/delegate-job.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';
import { resolveBranchId } from '../auth/utils/branch-resolver';

@ApiTags('ATS Job Openings & Requirements')
@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:create')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create new job requisition',
    description: 'Creates a new client job opening with full Ceipal-compatible field set.',
  })
  @ApiResponse({ status: 201, description: 'Job requisition created.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async create(
    @Body() dto: CreateJobDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    return this.jobsService.createJob(dto, tid, user?.dbId || user?.email || 'System', bid);
  }

  @Post('parse-jd')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Parse job description text using AI parser',
  })
  async parseJd(
    @Body() body: { text: string },
  ): Promise<any> {
    return this.jobsService.parseJobDescription(body?.text || '');
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retrieve all job openings',
    description: 'Lists all client vacancies and requisitions for the current tenant.',
  })
  @ApiResponse({ status: 200, description: 'Job list returned.' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('filter') filter?: string,
  ): Promise<JobProfile[]> {
    const tid = resolveTenantId(user, tenantId);
    const bid = resolveBranchId(user, branchHeaderId);
    return this.jobsService.findAllJobs(tid, user, bid, filter);
  }

  @Get('next-code')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get next sequential job code preview',
  })
  async getNextJobCode(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('branchId') queryBranchId?: string,
    @Query('shift') queryShift?: string,
  ): Promise<{ code: string }> {
    const tid = resolveTenantId(user, tenantId);
    const bid = queryBranchId || resolveBranchId(user, branchHeaderId);
    const code = await this.jobsService.getNextJobCode(tid, bid, queryShift);
    return { code };
  }

  @Get(':id/matches')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'AI-ranked candidate matches for a job',
    description:
      'Ranks the tenant candidate pool against this job using skill overlap (primary + secondary), experience fit, and resume-text keyword hits. Blends pgvector semantic similarity when the resume parser is online.',
  })
  @ApiParam({ name: 'id', description: 'Job UUID or job code', type: String })
  @ApiResponse({ status: 200, description: 'Ranked candidate matches returned.' })
  async matches(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Query('limit') limit?: string,
    @Query('minScore') minScore?: string,
  ): Promise<{ job: JobProfile; matches: CandidateMatch[]; parserOnline: boolean }> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.findMatchingCandidates(id, tid, {
      limit: limit ? parseInt(limit, 10) : undefined,
      minScore: minScore ? parseInt(minScore, 10) : undefined,
    });
  }

  @Get('delegations')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List incoming and outgoing delegation requests' })
  async getDelegations(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
    @Query('type') type: 'incoming' | 'outgoing' | 'all' = 'all'
  ) {
    const tid = resolveTenantId(user, tenantId) as string;
    const branchId = resolveBranchId(user, branchHeaderId) as string;
    return this.jobsService.getDelegationRequests(tid, branchId, type);
  }

  @Patch('delegations/:requestId/accept')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:accept_delegation')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept an incoming delegation request' })
  async acceptDelegation(
    @Param('requestId') requestId: string,
    @Body() dto: AcceptDelegationDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ) {
    console.log(`[JobsController] acceptDelegation called for requestId=${requestId}`);
    const tid = resolveTenantId(user, tenantId) as string;
    const targetBranchId = resolveBranchId(user, branchHeaderId) as string;
    return this.jobsService.acceptDelegation(requestId, dto, tid, targetBranchId);
  }

  @Patch('delegations/:requestId/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:accept_delegation')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject an incoming delegation request' })
  async rejectDelegation(
    @Param('requestId') requestId: string,
    @Body() dto: RejectDelegationDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId) as string;
    const targetBranchId = resolveBranchId(user, branchHeaderId) as string;
    return this.jobsService.rejectDelegation(requestId, dto, tid, targetBranchId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:view')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get job detail by ID or code',
    description: 'Retrieves full job profile including skills, rates, and recruiter assignments.',
  })
  @ApiParam({ name: 'id', description: 'Job UUID or JPC code', type: String })
  @ApiResponse({ status: 200, description: 'Job profile returned.' })
  @ApiResponse({ status: 404, description: 'Job not found.' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.findOneJob(id, tid);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:edit')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update job details and recruiter assignment',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.updateJob(id, dto, tid, user);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:approve')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve pending job requisition and activate for recruiters',
  })
  async approve(
    @Param('id') id: string,
    @Body() body: { assignedTo?: string; primaryRecruiterId?: string; podId?: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.approveJob(id, tid, user, body);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:reject')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reject pending job requisition with reviewer reason',
  })
  async reject(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.rejectJob(id, tid, user, body?.reason || '');
  }

  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:create')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Duplicate / Copy an existing job requisition',
  })
  async duplicateJob(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.duplicateJob(id, tid, user);
  }

  @Patch(':id/restore')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:edit')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restore a soft-deleted job requisition',
  })
  async restore(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<JobProfile> {
    const tid = resolveTenantId(user, tenantId);
    return this.jobsService.restoreJob(id, tid);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:edit')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Soft delete a job requisition',
  })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<void> {
    const tid = resolveTenantId(user, tenantId);
    await this.jobsService.deleteJob(id, tid);
  }

  // --- Cross-Branch Delegation Endpoints ---

  @Post(':id/delegate')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('job:delegate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delegate a job to another branch' })
  async delegateJob(
    @Param('id') jobId: string,
    @Body() dto: DelegateJobDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ) {
    const tid = resolveTenantId(user, tenantId) as string;
    const sourceBranchId = resolveBranchId(user, branchHeaderId) as string;
    return this.jobsService.delegateJob(jobId, dto, tid, sourceBranchId);
  }

}

