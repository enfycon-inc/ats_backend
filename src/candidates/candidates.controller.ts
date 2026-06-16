import { Controller, Get, Post, Delete, Body, Query, Param, Headers, ParseIntPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CandidatesService } from './candidates.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile } from './interfaces/candidate.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const DEFAULT_TENANT_ID = 'd3b07384-d113-49c3-a555-9ee75c13ca33';

@ApiTags('ATS Candidate Management')
@Controller('api/candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Directly Create & Import Candidate Profile',
    description: 'Executes a safe transaction creating candidate records and resume strings in Supabase.',
  })
  @ApiResponse({
    status: 201,
    description: 'Candidate profile and resume record created successfully in the shared database.',
  })
  async create(
    @Body() dto: CreateCandidateDto,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.candidatesService.createCandidate(dto, activeTenantId);
  }

  @Get()
  @ApiOperation({
    summary: 'Retrieve List of Candidate Profiles',
    description: 'Lists candidates with optional filters, pagination, and full text keyword scans across profiles.',
  })
  @ApiResponse({
    status: 200,
    description: 'Candidate profiles fetched successfully.',
  })
  async findAll(
    @Query() query: CandidateQueryDto,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile[]> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.candidatesService.findAll(query, activeTenantId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Detailed Candidate Profile by ID',
    description: 'Pulls a candidate profile and joins their complete resume and parsed details.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate detail fetched successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'The candidate profile with the specified database ID was not found.',
  })
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.candidatesService.findOne(id, activeTenantId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Candidate Profile by ID',
    description: 'Removes the candidate record and all joined work histories, education, skills, and resume attachments.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate profile and its linkages deleted successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Candidate not found.',
  })
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ message: string }> {
    const activeTenantId = tenantId || DEFAULT_TENANT_ID;
    return this.candidatesService.deleteCandidate(id, activeTenantId);
  }

  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Parse Resume File',
    description: 'Intercepts a resume upload, forwards it to Python FastAPI parser, and returns the structured JSON output.',
  })
  async parseResume(
    @UploadedFile() file: any,
  ): Promise<any> {
    return this.candidatesService.parseResumeFile(file);
  }

  @Get('dictionary/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'List Pending Normalization Terms',
    description: 'Super Admin only. Lists unmapped raw terms grouped by category.',
  })
  async getPendingNormalizations(): Promise<any[]> {
    return this.candidatesService.getPendingNormalizations();
  }

  @Post('dictionary/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve Pending Normalization Term',
    description: 'Super Admin only. Approves a raw term either as a new Canonical master term or maps it to an existing master ID as an Alias.',
  })
  async approveNormalization(
    @Body() body: {
      category: string;
      rawValue: string;
      action: 'canonical' | 'alias';
      canonicalId?: number;
      country?: string;
      state?: string;
      seniorityLevel?: string;
    },
  ): Promise<any> {
    return this.candidatesService.approveNormalization(body);
  }

  @Get('dictionary/:category')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Get Active Category Dictionary',
    description: 'Super Admin only. Lists all canonical terms and their aliases for a specific category (SKILL, DESIGNATION, COMPANY, LOCATION, DEGREE).',
  })
  async getCategoryDictionary(
    @Param('category') category: string,
  ): Promise<any[]> {
    return this.candidatesService.getCategoryDictionary(category);
  }

  @Post('dictionary/:category')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add Term to Active Category Dictionary',
    description: 'Super Admin only. Directly adds a new canonical master term or alias mapping under the specified category.',
  })
  async addDictionaryTerm(
    @Param('category') category: string,
    @Body() body: any,
  ): Promise<any> {
    return this.candidatesService.addDictionaryTerm(category, body);
  }

  @Delete('dictionary/:category/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Delete Term from Active Category Dictionary',
    description: 'Super Admin only. Deletes a canonical master term (and cascading aliases) or a specific alias mapping.',
  })
  async deleteDictionaryTerm(
    @Param('category') category: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type: 'canonical' | 'alias',
  ): Promise<any> {
    return this.candidatesService.deleteDictionaryTerm(category, id, type);
  }
}

