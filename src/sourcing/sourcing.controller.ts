import { Controller, Get, Post, Body, Query, Headers, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { SourcingService } from './sourcing.service';
import { SourcingSearchQueryDto } from './dtos/search-query.dto';
import { SourcingDownloadDto } from './dtos/download-candidate.dto';
import { ExternalCandidate, InternalCandidateProfile } from './interfaces/candidate.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';

@ApiTags('Talent Sourcing & Job Board Integrations')
@Controller('api/sourcing')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SourcingController {
  constructor(private readonly sourcingService: SourcingService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search Candidate Resumes from External Job Boards (Dice / Monster)',
    description: `Simulates querying external talent pools using standard REST and SOAP protocols. 
    In production, this initiates a client request using secured credentials and fetches list matches.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully fetched list of matching candidate profiles from the external job board.',
  })
  async searchCandidates(@Query() query: SourcingSearchQueryDto): Promise<ExternalCandidate[]> {
    return this.sourcingService.searchExternalCandidates(query);
  }

  @Post('download')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Import & Download Candidate Resume to Local Database',
    description: `Purchases/unlocks the external candidate's profile, unlocks real contact credentials (email/phone), 
    and inserts a normalized profile into our internal PostgreSQL database while creating an Applicant record.`,
  })
  @ApiBody({ type: SourcingDownloadDto })
  @ApiResponse({
    status: 201,
    description: 'Candidate purchased successfully and imported as a New Lead into the internal ATS.',
  })
  @ApiResponse({
    status: 404,
    description: 'The specified candidate ID was not found on the job board provider registry.',
  })
  async downloadCandidate(
    @Body() dto: SourcingDownloadDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<InternalCandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.sourcingService.downloadAndImportCandidate(dto, activeTenantId);
  }

  @Post('parse-resume')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Import & Parse Candidate Resume via AI Parser (with Celery & LLM/NLP Pipeline)',
    description: `Initiates profile purchase, unlocks real details, formats a virtual resume payload, 
    uploads it to the Python FastAPI parser/Celery task queue, polls the task status synchronous-to-client, 
    and saves to Supabase with pgvector embeddings.`,
  })
  @ApiBody({ type: SourcingDownloadDto })
  @ApiResponse({
    status: 201,
    description: 'Candidate purchased, parsed via AI pipeline, and imported successfully.',
  })
  async parseResume(
    @Body() dto: SourcingDownloadDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<InternalCandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.sourcingService.parseAndImportCandidateViaPython(dto, activeTenantId);
  }

  @Get('imported')
  @ApiOperation({
    summary: 'Retrieve All Downloaded External Profiles',
    description: 'Returns list of all external job board candidate profiles saved into the internal database.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved imported candidate profiles.',
  })
  async getImported(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<InternalCandidateProfile[]> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.sourcingService.getImportedProfiles(activeTenantId);
  }
}

