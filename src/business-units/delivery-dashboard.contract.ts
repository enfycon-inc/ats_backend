export const DELIVERY_STAGES = ['all', 'review', 'l1', 'l2', 'l3', 'final', 'closed', 'offers'] as const;
export const RECRUITER_SORTS = ['name', 'directActive', 'sharedJobs', 'submissions', 'rejected', 'review', 'l1', 'l2', 'l3', 'offers', 'joined'] as const;
export type RecruiterSort = typeof RECRUITER_SORTS[number];
export interface PerformanceCity<Row> {city:string;total:number;rows:Row[];summary:Record<string,number|null>}
export interface RecruiterFilters {
  cities?: string; performance?: string;
  search?: string; recruiterId?: string; podId?: string; from?: string; to?: string;
  sort?: RecruiterSort; direction?: 'asc' | 'desc'; offset?: number; limit?: number; snapshot?: string;
}
export interface RecruiterRow {
  city?: string; rejected?: number | null; assigned?: number | null;
  id: string; name: string; email: string | null; avatar: string | null; pod: string | null;
  directActive: number | null; sharedJobs: number | null; submissions: number | null;
  review: number | null; l1: number | null; l2: number | null; l3: number | null; offers: number | null; joined: number | null;
}
export interface RecruiterDashboard {
  features?: {podsEnabled:boolean};
  performanceCities?: PerformanceCity<RecruiterRow>[];
  unit: { id: string; name: string; branchName: string };
  rows: RecruiterRow[]; total: number; nextOffset: number | null; snapshot: string;
  summary: { activeJobs: number | null; submissions: number | null; offers: number | null; joined: number | null };
  options: { cities?: string[]; recruiters: { id: string; name: string }[]; pods: { id: string; name: string }[] };
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
  features?: RecruiterDashboard['features'];
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
  cities?: string; performance?: string;
  search?: string; clientId?: string; market?: string; employmentType?: string;
  accountManagerId?: string; from?: string; to?: string;
  sort?: ManagerSort; direction?: 'asc' | 'desc'; offset?: number; limit?: number; snapshot?: string;
}
export interface ManagerComparisonRow {
  city?: string;
  id: string; name: string; email: string | null; avatar: string | null;
  postedJobs: number | null; activeJobs: number | null; closedJobs: number | null; positions: number | null;
  submissions: number | null; review: number | null; l1: number | null;
  l2: number | null; l3: number | null; offers: number | null;
  joined: number | null; closed: number | null;
}
export interface ManagerDashboard {
  performanceCities?: PerformanceCity<ManagerComparisonRow>[];
  charts: ManagerDashboardCharts | null;
  unit: { id: string; name: string; branchName: string };
  rows: ManagerComparisonRow[]; total: number; offset: number; nextOffset: number | null;
  snapshot: string; updatedAt: string;
  summary: { postedJobs: number | null; activeJobs: number | null; joined: number | null; unassignedJobs: number | null };
  options: { cities?: string[]; clients: { id: string; name: string }[]; markets: string[]; employmentTypes: string[] };
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
  analytics?: DeliveryAnalytics;
  unit: { id: string; name: string; branchName: string };
  activeJobs: number | null;
  submissionRequired: number | null;
  pipeline: DeliveryPipeline | null;
  jobs: { id: string; jobTitle: string; jobCode: string; urgency: string; status: string; submissions: number | null }[];
  pendingUsers: { id: string; fullName: string; email: string; requestedRole: string | null }[] | null;
  pendingUserTotal: number | null;
  pendingUserPage: number;
  pods: { id: string; name: string; members: number; jobs: number | null }[] | null;
  submissions: DeliverySubmission[] | null;
  submissionTotal: number | null;
  submissionPage: number;
  stage: DeliveryStage;
  interviews: { id: string; candidateName: string; jobTitle: string; round: 'l1' | 'l2' | 'l3'; date: string }[] | null;
}
export interface DeliverySubmission {
  offeredAt?: string | null;
  id: string; candidateName: string; candidateEmail: string | null;
  jobId: string; jobTitle: string; jobCode: string; clientName: string | null;
  postedBy: { name: string; email: string | null; city?:string|null }; postedAt: string;
  submittedBy: { name: string; email: string | null; city?:string|null }; submittedAt: string; origin: string;
  finalStatus: string; stageStatus: string; updatedAt: string;
  rounds: { name: string; status: string | null; date: string | null }[];
}
export type DeliveryOptionKind = 'client' | 'postedBy' | 'submittedBy';
export interface DeliveryFilterOption { id: string; name: string; email: string | null }
export interface DeliveryFilterOptions { items: DeliveryFilterOption[]; nextPage: number | null }
export interface DeliveryJobPage {
  items: { id: string; jobTitle: string; jobCode: string; clientName: string | null; postedBy: { name: string; email: string | null }; postedAt: string; status: string; priority: string; jobType: string; submissions: number | null }[];
  total: number; page: number;
}
export interface DeliveryEmployee {
  avatar?: string | null;
  id: string; name: string; email: string; city: string; jobs: number | null; submissions: number | null;
  offers: number | null; joined: number | null; canRecruit: boolean; canPost: boolean;
}
export interface DeliveryCity {
  city: string; staff: number; jobs: number | null; submissions: number | null; offers: number | null; joined: number | null;
  employees: DeliveryEmployee[]; leaders: DeliveryEmployee[]; page: number;
}
export interface DeliveryAnalytics {
  jobResults?: DeliveryJobPage | null;
  timezone: string; from: string | null; to: string | null;
  jobCounts: { total: number; statuses: Record<string, number>; priorities: Record<string, number>; types: Record<string, number> } | null;
  rounds: Record<'l1' | 'l2' | 'l3', Record<string, number>> | null;
  final: Record<string, number> | null; review: number | null; totalSubmissions: number | null;
  offersReceived: number | null; undatedOffers: number | null; undatedJoins: number | null; websiteApplications: number | null; unattributed: number | null; unattributedJobs: number | null;
  availableCities: string[]; cities: DeliveryCity[] | null;
  submissionIds: string[]; submissionTotal: number; offeredDates: Record<string, string | null>;
  groups: { finalStatus: string; l1Status: string; l2Status: string | null; l3Status: string | null; _count: { _all: number } }[];
}
