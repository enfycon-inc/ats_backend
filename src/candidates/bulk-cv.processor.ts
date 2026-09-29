import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CandidatesService } from './candidates.service';
import * as fs from 'fs';
import * as path from 'path';

@Processor('bulk_cv')
export class BulkCvProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkCvProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatesService: CandidatesService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'parse_cv') {
      const { itemId, filePath, tenantId, createdBy, filename } = job.data;
      this.logger.log(`[BULK CV PROCESSOR] Starting processing for job ${job.id}, file: ${filename}`);

      // 1. Update item status to processing
      await this.prisma.bulkUploadItem.update({
        where: { id: itemId },
        data: { status: 'processing' },
      });

      let fileBuffer: Buffer;
      try {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Temp file not found at ${filePath}`);
        }
        fileBuffer = fs.readFileSync(filePath);
      } catch (err: any) {
        this.logger.error(`[BULK CV PROCESSOR] File read error: ${err.message}`);
        await this.prisma.bulkUploadItem.update({
          where: { id: itemId },
          data: { status: 'failed', errorMessage: err.message },
        });
        await this.updateBatchStatus(itemId);
        return;
      }

      try {
        // 2. Mock file structure for Multer
        const ext = path.extname(filename).toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === '.pdf') mime = 'application/pdf';
        else if (ext === '.doc') mime = 'application/msword';
        else if (ext === '.docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        else if (ext === '.txt') mime = 'text/plain';

        const mockFile = {
          originalname: filename,
          buffer: fileBuffer,
          mimetype: mime,
          size: fileBuffer.length,
        };

        // 3. Save CV using candidatesService (Option A de-duplication integrated)
        const result = await this.candidatesService.saveUploadedCv(mockFile, tenantId, {
          source: 'Bulk Upload',
        });

        // 4. Update item status to completed
        await this.prisma.bulkUploadItem.update({
          where: { id: itemId },
          data: {
            status: 'completed',
            candidateId: (result.candidate.dbId || result.candidate.id) ? String(result.candidate.dbId || result.candidate.id) : null,
            candidateName: result.candidate.fullName,
            candidateEmail: result.candidate.email || null,
          },
        });

        this.logger.log(`[BULK CV PROCESSOR] Successfully processed CV: ${filename} -> Candidate ID ${result.candidate.id}`);
      } catch (err: any) {
        this.logger.error(`[BULK CV PROCESSOR] Parsing failed for ${filename}: ${err.message}`);
        await this.prisma.bulkUploadItem.update({
          where: { id: itemId },
          data: {
            status: 'failed',
            errorMessage: `Parsing error: ${err.message}`,
          },
        });
      } finally {
        // Clean up temp file
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (unlinkErr: any) {
          this.logger.warn(`Failed to delete temp file ${filePath}: ${unlinkErr.message}`);
        }

        // Update parent batch progress
        await this.updateBatchStatus(itemId);
      }
    }
  }

  private async updateBatchStatus(itemId: string) {
    try {
      const item = await this.prisma.bulkUploadItem.findUnique({
        where: { id: itemId },
        select: { bulkUploadId: true },
      });
      if (!item) return;
      const batchId = item.bulkUploadId;

      const items = await this.prisma.bulkUploadItem.findMany({
        where: { bulkUploadId: batchId },
        select: { status: true },
      });

      const total = items.length;
      const completed = items.filter((i) => i.status === 'completed').length;
      const failed = items.filter((i) => i.status === 'failed').length;
      const processed = completed + failed;

      let status = 'processing';
      if (processed >= total) {
        status = 'completed';
      }

      await this.prisma.bulkUpload.update({
        where: { id: batchId },
        data: {
          processedFiles: completed,
          failedFiles: failed,
          status,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to update batch progress: ${err.message}`);
    }
  }
}
