import type { TrackerSubmission } from './tracker-contract';

export const RESUME_HANDOFF_STATUSES = ['SUBMITTED', 'SELECTED', 'OFFER', 'JOIN'];

// Client handoff is available only after approval and while the submission is viable.
export function canDownloadSubmissionResume(submission: Pick<TrackerSubmission, 'finalStatus'>, permissions: string[] = []): boolean {
  return permissions.some(permission => ['*', 'submission:download_resume', 'candidate:download_resume'].includes(permission))
    && RESUME_HANDOFF_STATUSES.includes(submission.finalStatus);
}
