import { Controller, Get, Post, Delete, Patch, Body, Query, Param, Headers, ParseUUIDPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFile, UploadedFiles, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CandidatesService } from './candidates.service';
import { CreateCandidateDto } from './dtos/create-candidate.dto';
import { CandidateQueryDto } from './dtos/candidate-query.dto';
import { CandidateProfile } from './interfaces/candidate.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { resolveTenantId } from '../auth/utils/tenant-resolver';
import { resolveBranchId } from '../auth/utils/branch-resolver';

@ApiTags('ATS Candidate Management')
@Controller('api/candidates')
export class CandidatesController {
  constructor(
    private readonly candidatesService: CandidatesService,
    private readonly prisma: PrismaService,
    @InjectQueue('bulk_cv') private readonly bulkQueue: Queue,
  ) {}

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
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() dto: CreateCandidateDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const activeBranchId = resolveBranchId(user, branchHeaderId);
    if (activeBranchId && !dto.branchId) {
      dto.branchId = activeBranchId;
    }
    return this.candidatesService.createCandidate(dto, activeTenantId, user);
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
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Query() query: CandidateQueryDto,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<CandidateProfile[]> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const activeBranchId = resolveBranchId(user, branchHeaderId);
    const isAllBranches = query.allBranches === true || String(query.allBranches).toLowerCase() === 'true';
    if (activeBranchId && !query.branchId && !isAllBranches) {
      query.branchId = activeBranchId;
    }
    return this.candidatesService.findAll(query, activeTenantId, user);
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
  @UseGuards(JwtAuthGuard)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.candidatesService.findOne(id, activeTenantId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Candidate Profile by ID',
    description: 'Updates candidate details in the database.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate profile updated successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Candidate not found.',
  })
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.candidatesService.updateCandidate(id, dto, activeTenantId);
  }

  @Patch(':id/restore')
  @ApiOperation({
    summary: 'Restore a soft-deleted Candidate Profile by ID',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.candidatesService.restoreCandidate(id, activeTenantId);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Soft Delete Candidate Profile by ID',
    description: 'Soft-deletes the candidate record.',
  })
  @ApiParam({ name: 'id', description: 'The integer Database ID of the candidate record', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Candidate profile soft-deleted successfully.',
  })
  @ApiResponse({
    status: 404,
    description: 'Candidate not found.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ message: string }> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.candidatesService.deleteCandidate(id, activeTenantId);
  }

  @Post('parse')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Parse Resume File',
    description: 'Intercepts a resume upload, forwards it to Python FastAPI parser, and returns structured candidate details for auto-filling.',
  })
  async parseResume(
    @UploadedFile() file: any,
  ): Promise<any> {
    if (!file) throw new BadRequestException('No file uploaded.');
    const parsed = await this.candidatesService.parseResumeFile(file);

    // Normalize response for frontend auto-fill
    const contact = parsed?.contact || {};
    let fallbackName = file.originalname?.replace(/\.[^.]+$/, '') || '';
    fallbackName = fallbackName
      .replace(/\(\d+\)/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\b(resume|cv|curriculum\s+vitae|vitae|profile|biodata|final|latest)\b/gi, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let rawName = (parsed?.candidate_name && parsed.candidate_name !== 'Unknown')
      ? parsed.candidate_name
      : fallbackName;

    rawName = rawName
      .replace(/\(\d+\)/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\b(resume|cv|curriculum\s+vitae|vitae|profile|biodata)\b/gi, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanName = rawName || 'Candidate';
    const nameParts = cleanName.split(' ');
    const firstName = nameParts.length > 0 ? nameParts[0] : '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    const email = (contact.emails && contact.emails[0]) || parsed?.email || '';
    const phone = (contact.phones && contact.phones[0]) || parsed?.phone || '';

    return {
      ...parsed,
      candidateName: cleanName,
      firstName,
      lastName,
      email,
      phone,
    };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload, parse & save a CV',
    description:
      'One-shot CV import: de-duplicates on file hash, parses via the Python service (best-effort), stores the original file bytes, and creates the linked candidate.',
  })
  @ApiResponse({ status: 201, description: 'Candidate created (or existing duplicate returned).' })
  @UseGuards(JwtAuthGuard)
  async uploadCv(
    @UploadedFile() file: any,
    @CurrentUser() user: AuthUser,
    @Body('source') source?: string,
    @Body('fullName') fullName?: string,
    @Body('email') email?: string,
    @Body('phone') phone?: string,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-branch-id') branchHeaderId?: string,
  ): Promise<{ candidate: CandidateProfile; duplicate: boolean; parsed: boolean }> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const activeBranchId = resolveBranchId(user, branchHeaderId);
    return this.candidatesService.saveUploadedCv(file, activeTenantId, { 
      source,
      fullName,
      email,
      phone,
      branchId: activeBranchId || undefined,
      market: user?.defaultMarket || 'US',
    }, user);
  }

  @Get(':id/resume')
  @ApiOperation({
    summary: 'Download / preview a candidate CV',
    description: 'Streams the original stored resume file for the candidate.',
  })
  @ApiParam({ name: 'id', description: 'Candidate database ID', type: Number })
  @UseGuards(JwtAuthGuard)
  async downloadResume(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<void> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const cv = await this.candidatesService.getResumeFile(id, activeTenantId);
    res.setHeader('Content-Type', cv.mime);
    res.setHeader('Content-Disposition', `inline; filename="${cv.filename.replace(/"/g, '')}"`);
    res.send(cv.data);
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
    @Param('id', ParseUUIDPipe) id: string,
    @Query('type') type: 'canonical' | 'alias',
  ): Promise<any> {
    return this.candidatesService.deleteDictionaryTerm(category, id, type);
  }

  @Post('bulk-upload')
  @UseInterceptors(FilesInterceptor('files'))
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Bulk Upload CVs',
    description: 'Accepts multiple CV files, stores them temporarily, creates a tracking batch, and enqueues parsing tasks.',
  })
  async bulkUpload(
    @UploadedFiles() files: any[],
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<{ bulkUploadId: string }> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const createdBy = user?.fullName || user?.email || 'System';

    if (!files || files.length === 0) {
      throw new Error('No files uploaded.');
    }

    // 1. Create bulk_uploads record
    const batch = await this.prisma.bulkUpload.create({
      data: {
        tenantId: activeTenantId,
        createdBy,
        totalFiles: files.length,
        status: 'processing',
      },
      select: { id: true },
    });
    const bulkUploadId = batch.id;

    // Create temp directory inside workspace cwd
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    
    const tempDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 2. Loop and write to disk, create item in DB, enqueue in BullMQ
    for (const file of files) {
      const fileId = crypto.randomUUID();
      const tempFileName = `${fileId}_${file.originalname}`;
      const tempFilePath = path.join(tempDir, tempFileName);

      fs.writeFileSync(tempFilePath, file.buffer);

      // Create tracking item in database
      const item = await this.prisma.bulkUploadItem.create({
        data: {
          bulkUploadId,
          filename: file.originalname,
          status: 'queued',
        },
        select: { id: true },
      });
      const itemId = item.id;

      // Enqueue job in BullMQ
      await this.bulkQueue.add('parse_cv', {
        itemId,
        filePath: tempFilePath,
        tenantId: activeTenantId,
        createdBy,
        filename: file.originalname,
      });
    }

    return { bulkUploadId };
  }

  @Get('bulk-uploads')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'List Bulk Uploads History',
    description: 'Retrieves all bulk upload batches for the active tenant.',
  })
  async getBulkUploads(
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<any[]> {
    const activeTenantId = resolveTenantId(user, tenantId);
    const batches = await this.prisma.bulkUpload.findMany({
      where: { tenantId: activeTenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        createdBy: true,
        totalFiles: true,
        processedFiles: true,
        failedFiles: true,
        status: true,
        createdAt: true,
      },
    });
    return batches.map((b) => ({
      id: b.id,
      created_by: b.createdBy,
      total_files: b.totalFiles,
      processed_files: b.processedFiles,
      failed_files: b.failedFiles,
      status: b.status,
      created_at: b.createdAt,
    }));
  }

  @Get('bulk-uploads/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get Bulk Upload Batch Details & Status',
    description: 'Retrieves status of a bulk upload batch and all its individual child items.',
  })
  async getBulkUpload(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<any> {
    const activeTenantId = resolveTenantId(user, tenantId);
    
    const batch = await this.prisma.bulkUpload.findFirst({
      where: { id, tenantId: activeTenantId },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    
    if (!batch) {
      return { error: 'Batch not found.' };
    }

    return {
      batch: {
        id: batch.id,
        created_by: batch.createdBy,
        total_files: batch.totalFiles,
        processed_files: batch.processedFiles,
        failed_files: batch.failedFiles,
        status: batch.status,
        created_at: batch.createdAt,
      },
      items: batch.items.map((item) => ({
        id: item.id,
        filename: item.filename,
        status: item.status,
        error_message: item.errorMessage,
        candidate_id: item.candidateId,
        candidate_name: item.candidateName,
        candidate_email: item.candidateEmail,
        created_at: item.createdAt,
      })),
    };
  }
}

