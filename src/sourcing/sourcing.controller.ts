import { Controller, Get, Post, Body, Query, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { SourcingService } from './sourcing.service';
import { SourcingSearchQueryDto } from './dtos/search-query.dto';
import { SourcingDownloadDto } from './dtos/download-candidate.dto';
import { ExternalCandidate, InternalCandidateProfile } from './interfaces/candidate.interface';

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

@ApiTags('Talent Sourcing & Job Board Integrations')
@Controller('api/sourcing')
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
    schema: {
      type: 'array',
      items: {
        example: {
          externalId: 'DICE-48168',
          fullName: 'Manoj Duggi',
          email: 'm-duggi-dice-obfuscated@dice.com',
          phone: '334-XXX-XXXX',
          location: 'Herndon, VA',
          currentTitle: 'Email Security Engineer',
          currentCompany: 'IronBow Technologies',
          skills: ['Email Security', 'Proofpoint', 'Cybersecurity'],
          experienceYears: 6,
          workAuthorization: 'Have H1 Visa',
          source: 'dice',
          resumeHtml: '<h1>Manoj Duggi</h1><p>Email Security Specialist...</p>',
        },
      },
    },
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
    schema: {
      example: {
        id: 'INT-DICE-DICE-48168',
        applicantId: 'APP-65912',
        fullName: 'Manoj Duggi',
        email: 'manojduggi@gmail.com',
        phone: '+1 (334) 555-4816',
        city: 'Herndon',
        state: 'VA',
        source: 'Dice',
        status: 'New lead',
        jobTitle: 'Email Security Engineer',
        skills: ['Email Security', 'Proofpoint', 'Cybersecurity'],
        workAuthorization: 'Have H1 Visa',
        experienceYears: 6,
        rawText: 'Manoj Duggi\nEmail Security Specialist with 6 years experience...',
        createdOn: '2026-05-20T05:20:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'The specified candidate ID was not found on the job board provider registry.',
  })
  async downloadCandidate(
    @Body() dto: SourcingDownloadDto,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<InternalCandidateProfile> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
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
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<InternalCandidateProfile> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
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
  async getImported(@Headers('x-tenant-id') tenantId?: string): Promise<InternalCandidateProfile[]> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.sourcingService.getImportedProfiles(activeTenantId);
  }
}

