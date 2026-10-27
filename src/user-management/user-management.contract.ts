export type Presence = 'active' | 'away' | 'offline' | 'unknown';
export type UserView = 'active' | 'pending' | 'blocked' | 'activity';
export interface ManagementRow {
  id: string; kind: 'user' | 'invitation'; fullName: string; email: string;
  avatar: string | null; city: string | null; managerName: string | null; assignedRoles: string[];
  assignedRoleIds?: string[]; jobReviewerId?: string | null;
  branchId?: string | null; businessUnitId?: string | null;
  branchName: string | null; businessUnitName: string | null; roleName: string | null;
  isActive: boolean; isApproved: boolean; requestedRole: string | null;
  lastLoginAt: string | null; createdAt: string; invitationStatus?: 'invited' | 'expired';
  presence?: Presence; lastSeenAt?: string | null; sessions?: number;
  blockReason?: string | null;
  officeNetwork?: string; officeObservedAt?: string | null;
  allowedActions?: { edit: boolean; changeAccess: boolean; review: boolean; resendInvitation: boolean; assignManager?: boolean; resetPassword?: boolean; endSessions?: boolean; deleteUser?: boolean };
}
export interface DirectoryPage {
  items: ManagementRow[]; total: number; page: number; pageSize: number;
  counts: { active: number; pending: number; blocked: number };
  asOf: string; telemetryEnabled: boolean;
}
export interface SessionItem {
  id: string; device: string; loginMethod: string; startedAt: string;
  lastSeenAt: string; expiresAt: string; revokedAt: string | null;
  ipAddress?: string | null; current: boolean;
}
export interface SecurityEventItem {
  id: string; action: string; outcome: string; createdAt: string;
  ipAddress?: string | null; actorName: string | null;
}
export const MANAGEMENT_PERMISSIONS = [
  ['user:view', 'View user directory'], ['user:presence:view', 'View team presence'],
  ['user:sessions:view', 'View user sessions'], ['user:login_logs:view', 'View login security history'],
  ['user:session_ip:view', 'View session IP addresses'], ['user:sessions:revoke', 'Revoke user sessions'],
  ['user:login_logs:export', 'Export login history'], ['user:location:view', 'View office location evidence'],
  ['branch:network:manage', 'Manage office networks'],
  ['unit:geofence:manage', 'Manage operating unit geofences'],
] as const;
