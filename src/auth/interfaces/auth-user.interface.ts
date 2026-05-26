/**
 * Normalized user identity attached to every authenticated request.
 * This interface is the single source of truth for request.user,
 * regardless of whether AUTH_PROVIDER is "mock" or "keycloak".
 */
export interface AuthUser {
  /** Internal database UUID from the `users` table */
  dbId: string;
  /** Keycloak subject UUID (or "MOCK-{dbId}" in mock mode) */
  keycloakId: string;
  /** User's email address */
  email: string;
  /** User's full display name */
  fullName: string;
  /** Normalized, uppercase roles e.g. ["RECRUITER", "ADMIN"] */
  roles: string[];
  /** The SaaS tenant UUID this user belongs to */
  tenantId: string;
  /** True if account is active */
  isActive: boolean;
}
