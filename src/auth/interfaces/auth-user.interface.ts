/**
 * Normalized user identity attached to every authenticated request.
 * This interface is the single source of truth for request.user,
 * regardless of whether AUTH_PROVIDER is "mock" or "keycloak".
 */
export interface AuthUser {
  /** Internal database UUID from the `users` table */
  dbId: string;
  /** Keycloak subject UUID */
  keycloakId: string;
  /** User's email address */
  email: string;
  /** User's full display name */
  fullName: string;
  /** Normalized, uppercase roles e.g. ["RECRUITER", "TENANT_ADMIN"] */
  roles: string[];
  /** The SaaS tenant UUID this user belongs to */
  tenantId: string;
  /** True if account is active */
  isActive: boolean;
  /** Granular permission strings for this user's custom role */
  permissions?: string[];
  /** Assigned pod ID if user is member of a pod */
  podId?: string;
  /** Assigned branch ID */
  branchId?: string;

  /** User's base system role e.g. 'BRANCH_ADMIN', 'RECRUITER' */
  systemRole?: string;
  /** Assigned business unit ID */
  businessUnitId?: string;
  /** Default market segment ('US' vs 'INDIA') */
  defaultMarket?: string;
}
