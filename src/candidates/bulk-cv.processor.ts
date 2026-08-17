import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CandidatesService } from './candidates.service';
import * as fs from 'fs';
import * as path from 'path';

@Processor('bulk_cv')
export class BulkCvProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkCvProcessor.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly candidatesService: CandidatesService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'parse_cv') {
      const { itemId, filePath, tenantId, createdBy, filename } = job.data;
      this.logger.log(`[BULK CV PROCESSOR] Starting processing for job ${job.id}, file: ${filename}`);

      // 1. Update item status to processing
      await this.db.query(
        `UPDATE bulk_upload_items SET status = 'processing' WHERE id = $1`,
        [itemId]
      );

      let fileBuffer: Buffer;
      try {
        if (!fs.existsSync(filePath)) {
          throw new Error(`Temp file not found at ${filePath}`);
        }
        fileBuffer = fs.readFileSync(filePath);
      } catch (err) {
        this.logger.error(`[BULK CV PROCESSOR] File read error: ${err.message}`);
        await this.db.query(
          `UPDATE bulk_upload_items 
           SET status = 'failed', error_message = $1 
           WHERE id = $2`,
          [err.message, itemId]
        );
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
        await this.db.query(
          `UPDATE bulk_upload_items 
           SET status = 'completed', 
               candidate_id = $1, 
               candidate_name = $2, 
               candidate_email = $3
           WHERE id = $4`,
          [result.candidate.dbId || result.candidate.id, result.candidate.fullName, result.candidate.email || null, itemId]
        );

        this.logger.log(`[BULK CV PROCESSOR] Successfully processed CV: ${filename} -> Candidate ID ${result.candidate.id}`);
      } catch (err) {
        this.logger.error(`[BULK CV PROCESSOR] Parsing failed for ${filename}: ${err.message}`);
        await this.db.query(
          `UPDATE bulk_upload_items 
           SET status = 'failed', error_message = $1 
           WHERE id = $2`,
          [`Parsing error: ${err.message}`, itemId]
        );
      } finally {
        // Clean up temp file
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (unlinkErr) {
          this.logger.warn(`Failed to delete temp file ${filePath}: ${unlinkErr.message}`);
        }

        // Update parent batch progress
        await this.updateBatchStatus(itemId);
      }
    }
  }

  private async updateBatchStatus(itemId: string) {
    try {
      // Find parent bulk_upload_id
      const itemRes = await this.db.query(
        `SELECT bulk_upload_id FROM bulk_upload_items WHERE id = $1`,
        [itemId]
      );
      if (itemRes.rows.length === 0) return;
      const batchId = itemRes.rows[0].bulk_upload_id;

      // Count completed / failed items
      const statsRes = await this.db.query(
        `SELECT 
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'completed') as completed,
           COUNT(*) FILTER (WHERE status = 'failed') as failed
         FROM bulk_upload_items 
         WHERE bulk_upload_id = $1`,
        [batchId]
      );
      
      const stats = statsRes.rows[0];
      const total = parseInt(stats.total, 10);
      const completed = parseInt(stats.completed, 10);
      const failed = parseInt(stats.failed, 10);
      const processed = completed + failed;

      let status = 'processing';
      if (processed >= total) {
        status = 'completed';
      }

      await this.db.query(
        `UPDATE bulk_uploads 
         SET processed_files = $1, 
             failed_files = $2, 
             status = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [completed, failed, status, batchId]
      );
    } catch (err) {
      this.logger.error(`Failed to update batch progress: ${err.message}`);
    }
  }
}
