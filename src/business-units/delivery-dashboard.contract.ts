export const DELIVERY_STAGES = ['all', 'review', 'l1', 'l2', 'l3', 'final', 'closed'] as const;
export const RECRUITER_SORTS = ['name', 'directActive', 'sharedJobs', 'submissions', 'review', 'l1', 'l2', 'l3', 'offers', 'joined'] as const;
export type RecruiterSort = typeof RECRUITER_SORTS[number];
export interface RecruiterFilters {
  search?: string; recruiterId?: string; podId?: string; from?: string; to?: string;
  sort?: RecruiterSort; direction?: 'asc' | 'desc'; offset?: number; limit?: number; snapshot?: string;
}
export interface RecruiterRow {
  id: string; name: string; email: string | null; avatar: string | null; pod: string | null;
  directActive: number | null; sharedJobs: number | null; submissions: number | null;
  review: number | null; l1: number | null; l2: number | null; l3: number | null; offers: number | null; joined: number | null;
}
export interface RecruiterDashboard {
  unit: { id: string; name: string; branchName: string };
  rows: RecruiterRow[]; total: number; nextOffset: number | null; snapshot: string;
  summary: { activeJobs: number | null; submissions: number | null; offers: number | null; joined: number | null };
  options: { recruiters: { id: string; name: string }[]; pods: { id: string; name: string }[] };
  charts: { closures: { id: string; name: string; count: number }[]; pipeline: ManagerDashboardCharts['pipeline'];
    submissions: ManagerDashboardCharts['weekly']; closuresWeekly: ManagerDashboardCharts['weekly']; scope: ManagerDashboardCharts['weeklyScope'] } | null;
  undatedOutcomes: number | null; unattributedSubmissions: number | null;
}
export interface RecruiterDetailFilters {
  from?: string; to?: string; tab?: 'jobs' | 'submissions' | 'clients'; page?: number;
  search?: string; assignment?: 'direct' | 'shared'; status?: string; clientId?: string;
  attention?: 'review' | 'feedback' | 'upcoming';
}
export interface RecruiterDetailRow {
  id: string; title: string; code: string | null; clientName: string | null; assignment: 'direct' | 'shared' | null;
  accountManager: string | null; status: string | null; createdAt: string | null; interviewAt: string | null;
  submissions: number | null; review: number | null; offers: number | null; joined: number | null;
}
export interface RecruiterPerformance {
  recruiter: RecruiterRow; unit: RecruiterDashboard['unit']; charts: RecruiterDashboard['charts'];
  pipeline: ManagerDashboardCharts['pipeline'][number] | null;
  attention: { review: number | null; feedback: number | null; upcoming: number | null };
  table: { rows: RecruiterDetailRow[]; total: number; page: number; limit: number; tab: 'jobs' | 'submissions' | 'clients' };
  clients: { id: string; name: string }[]; undatedOutcomes: number | null;
}
export type DeliveryStage = typeof DELIVERY_STAGES[number];
export const MANAGER_SORTS = ['joined', 'offers', 'submissions', 'activeJobs', 'postedJobs', 'closedJobs', 'positions', 'review', 'l1', 'l2', 'l3', 'name'] as const;
export type ManagerSort = typeof MANAGER_SORTS[number];
export interface ManagerDashboardFilters {
  search?: string; clientId?: string; market?: string; employmentType?: string;
  accountManagerId?: string; from?: string; to?: string;
  sort?: ManagerSort; direction?: 'asc' | 'desc'; offset?: number; limit?: number; snapshot?: string;
}
export interface ManagerComparisonRow {
  id: string; name: string; email: string | null; avatar: string | null;
  postedJobs: number | null; activeJobs: number | null; closedJobs: number | null; positions: number | null;
  submissions: number | null; review: number | null; l1: number | null;
  l2: number | null; l3: number | null; offers: number | null;
  joined: number | null; closed: number | null;
}
export interface ManagerDashboard {
  charts: ManagerDashboardCharts | null;
  unit: { id: string; name: string; branchName: string };
  rows: ManagerComparisonRow[]; total: number; offset: number; nextOffset: number | null;
  snapshot: string; updatedAt: string;
  summary: { postedJobs: number | null; activeJobs: number | null; joined: number | null; unassignedJobs: number | null };
  options: { clients: { id: string; name: string }[]; markets: string[]; employmentTypes: string[] };
  managers: { id: string; name: string }[];
  undatedOutcomes: number | null;
  undatedPostedJobs: number | null;
}
export interface ManagerDashboardCharts {
  closures: { id: string; name: string; count: number }[];
  pipeline: { id: string; name: string; review: number | null; l1: number; l2: number; l3: number; offers: number }[];
  weekly: { from: string; to: string; count: number }[];
  weeklyScope: 'selected-period' | 'last-12-weeks';
  undatedClosures: number;
}
export interface ManagerDetailFilters {
  from?: string; to?: string; clientId?: string; employmentType?: string;
  jobSearch?: string; jobStatus?: string; jobPage?: number; clientPage?: number;
  clientMode?: 'added' | 'portfolio'; attention?: 'review' | 'uncovered';
}
export interface ManagerJobPerformance {
  id: string; title: string; code: string; status: string; clientId: string | null; clientName: string | null;
  employmentType: string; positions: number; postedJobs: number; postedPositions: number;
  submissions: number | null; review: number | null; offers: number | null; joined: number | null;
}
export interface ManagerClientPerformance {
  id: string; name: string; status: string; addedByManager: boolean; addedAt: string;
  postedJobs: number | null; activeJobs: number | null; closedJobs: number | null; positions: number | null;
  submissions: number | null; review: number | null; offers: number | null; joined: number | null;
}
export interface ManagerPerformanceDetail {
  manager: ManagerComparisonRow; unit: ManagerDashboard['unit']; pipeline: ManagerDashboardCharts['pipeline'][number] | null;
  weekly: { submissions: ManagerDashboardCharts['weekly'] | null; closures: ManagerDashboardCharts['weekly'] | null; clientsAdded: ManagerDashboardCharts['weekly'] | null };
  weeklyScope: ManagerDashboardCharts['weeklyScope'];
  attention: { uncoveredJobs: number | null; pendingReview: number | null };
  jobs: { rows: ManagerJobPerformance[]; total: number; page: number; limit: number };
  clients: { rows: ManagerClientPerformance[]; total: number; page: number; limit: number; added: number | null; portfolio: number | null; closures: { id: string; name: string; count: number }[] };
  options: { clients: { id: string; name: string }[]; employmentTypes: string[] };
  undatedOutcomes: number | null; undatedPostedJobs: number | null;
}
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
