import {
  Controller, Get, Post, Body, Param, Headers,
  HttpStatus, HttpCode, UseGuards,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth,
} from '@nestjs/swagger';
import { JobsService, JobProfile } from './jobs.service';
import { CreateJobDto } from './dtos/create-job.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

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
  ): Promise<JobProfile> {
    const tid = tenantId || user?.tenantId || DEFAULT_TENANT_ID;
    return this.jobsService.createJob(dto, tid, user?.dbId || 'System');
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
  ): Promise<JobProfile[]> {
    const tid = tenantId || user?.tenantId || DEFAULT_TENANT_ID;
    return this.jobsService.findAllJobs(tid);
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
  ): Promise<{ code: string }> {
    const tid = tenantId || user?.tenantId || DEFAULT_TENANT_ID;
    const code = await this.jobsService.getNextJobCode(tid);
    return { code };
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
    const tid = tenantId || user?.tenantId || DEFAULT_TENANT_ID;
    return this.jobsService.findOneJob(id, tid);
  }
}
