export const DELIVERY_STAGES = ['all', 'review', 'l1', 'l2', 'l3', 'final', 'closed'] as const;
export type DeliveryStage = typeof DELIVERY_STAGES[number];
export interface DeliveryPipeline {
  total: number; review: number; l1: number; l2: number; l3: number; final: number; closed: number;
  decision: number; selected: number; offers: number; joined: number; scheduled: number;
  rounds: Record<'l1' | 'l2' | 'l3', { pending: number; scheduled: number; feedback: number; cancelled: number }>;
}
export interface DeliveryDashboard {
  unit: { id: string; name: string; branchName: string };
  activeJobs: number | null;
  submissionRequired: number | null;
  pipeline: DeliveryPipeline | null;
  jobs: { id: string; jobTitle: string; jobCode: string; urgency: string; status: string; submissions: number | null }[];
  pendingUsers: { id: string; fullName: string; email: string; requestedRole: string | null }[] | null;
  pendingUserTotal: number | null;
  pendingUserPage: number;
  pods: { id: string; name: string; members: number; jobs: number | null }[] | null;
  submissions: { id: string; candidateName: string; jobTitle: string; finalStatus: string; updatedAt: string }[] | null;
  submissionTotal: number | null;
  submissionPage: number;
  stage: DeliveryStage;
  interviews: { id: string; candidateName: string; jobTitle: string; round: 'l1' | 'l2' | 'l3'; date: string }[] | null;
}
