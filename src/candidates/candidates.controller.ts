import { Controller, Get, Post, Delete, Patch, Body, Query, Param, Headers, ParseIntPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFile, UploadedFiles, UseGuards, Res } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.service';
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
    private readonly db: DatabaseService,
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
    if (activeBranchId && !query.branchId && !query.allBranches) {
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
    @Param('id', ParseIntPipe) id: number,
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @Headers('x-tenant-id') tenantId?: string,
  ): Promise<CandidateProfile> {
    const activeTenantId = resolveTenantId(user, tenantId);
    return this.candidatesService.updateCandidate(id, dto, activeTenantId);
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  async delete(
    @Param('id', ParseIntPipe) id: number,
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
    description: 'Intercepts a resume upload, forwards it to Python FastAPI parser, and returns the structured JSON output.',
  })
  async parseResume(
    @UploadedFile() file: any,
  ): Promise<any> {
    return this.candidatesService.parseResumeFile(file);
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
    @Param('id', ParseIntPipe) id: number,
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
    @Param('id', ParseIntPipe) id: number,
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
    const batchRes = await this.db.query(
      `INSERT INTO bulk_uploads (tenant_id, created_by, total_files, status)
       VALUES ($1, $2, $3, 'processing')
       RETURNING id`,
      [activeTenantId, createdBy, files.length]
    );
    const bulkUploadId = batchRes.rows[0].id;

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
      const itemRes = await this.db.query(
        `INSERT INTO bulk_upload_items (bulk_upload_id, filename, status)
         VALUES ($1, $2, 'queued')
         RETURNING id`,
        [bulkUploadId, file.originalname]
      );
      const itemId = itemRes.rows[0].id;

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
    const res = await this.db.query(
      `SELECT id, created_by, total_files, processed_files, failed_files, status, created_at
       FROM bulk_uploads
       WHERE tenant_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [activeTenantId]
    );
    return res.rows;
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
    
    const batchRes = await this.db.query(
      `SELECT id, created_by, total_files, processed_files, failed_files, status, created_at
       FROM bulk_uploads
       WHERE id = $1 AND tenant_id = $2`,
      [id, activeTenantId]
    );
    
    if (batchRes.rows.length === 0) {
      return { error: 'Batch not found.' };
    }

    const itemsRes = await this.db.query(
      `SELECT id, filename, status, error_message, candidate_id, candidate_name, candidate_email, created_at
       FROM bulk_upload_items
       WHERE bulk_upload_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return {
      batch: batchRes.rows[0],
      items: itemsRes.rows,
    };
  }
}

