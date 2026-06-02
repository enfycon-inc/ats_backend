import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';
import { DatabaseService } from '../database/database.service';

@Processor('mass_mail')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly db: DatabaseService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'send_email') {
      const { recipientId, campaignId, accountId, subject, body, toEmail, firstName, lastName, metadata } = job.data;
      
      try {
        // Check if recipient was cancelled
        const statusRes = await this.db.query('SELECT status FROM mass_mail.recipients WHERE id = $1', [recipientId]);
        if (statusRes.rows.length > 0 && statusRes.rows[0].status === 'Cancelled') {
          return; // Silently skip cancelled jobs to avoid log flooding
        }

        this.logger.log(`Processing job ${job.id} of type ${job.name} for ${toEmail}`);

        const mergeFieldRegex = /\{\{([^}]+)\}\}/g;
        
        const replaceField = (match: string, p1: string) => {
          // Special fallback for common hardcoded templates
          if (p1 === 'Candidate_Name' && !metadata?.[p1]) return firstName || 'Candidate';
          if (p1 === 'Job_Title' && !metadata?.[p1]) return metadata?.['Job Title'] || metadata?.job_title || 'Your Role';
          if (p1 === 'Company_Name' && !metadata?.[p1]) return metadata?.['Company Name'] || metadata?.company_name || 'our company';
          
          // Dynamic CSV field lookup
          return metadata?.[p1] || match; 
        };

        const personalizedSubject = subject.replace(mergeFieldRegex, replaceField);
        const personalizedBody = body.replace(mergeFieldRegex, replaceField);

        // Send Microsoft Email via Graph
        await this.emailService.sendMicrosoftEmail(accountId, personalizedSubject, personalizedBody, toEmail);

        // Update status to SENT
        await this.db.query(
          `UPDATE mass_mail.recipients SET status = 'Sent', sent_at = NOW() WHERE id = $1`,
          [recipientId]
        );
      } catch (err) {
        this.logger.error(`Failed to send email to ${toEmail}: ${err.message}`);
        await this.db.query(
          `UPDATE mass_mail.recipients SET status = 'Failed', sent_at = NOW() WHERE id = $1`,
          [recipientId]
        );
        throw err;
      }
    }
  }
}
