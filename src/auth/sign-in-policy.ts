// Canonical contract. Sync to the frontend using sync-sign-in-policy.cjs.
export interface SignInPolicy {
  tenantId: string;
  allowPasswordLogin: boolean;
  allowMicrosoftSso: boolean;
  allowGoogleSso: boolean;
  allowDeveloperLogin: boolean;
  enforceSsoOnly: boolean;
  requireMfa: boolean;
  allowPersonalEmails: boolean;
  allowedEmailDomains: string[];
  microsoftTenantId?: string | null;
  microsoftClientId?: string | null;
  name?: string;
  siteTitle?: string;
  logoUrl?: string;
  microsoftRedirectUri?: string | null;
}
export type SignInPolicyUpdate = Partial<Pick<SignInPolicy,
  'allowPasswordLogin' | 'allowMicrosoftSso' | 'allowGoogleSso' | 'allowDeveloperLogin' |
  'enforceSsoOnly' | 'requireMfa' | 'allowPersonalEmails' | 'allowedEmailDomains' |
  'microsoftTenantId' | 'microsoftClientId'>> & { microsoftClientSecret?: string | null };

export function signInOptions(policy: Pick<SignInPolicy, 'allowPasswordLogin' | 'enforceSsoOnly' | 'allowDeveloperLogin'> & { requireMfa?: boolean }) {
  return { password: policy.allowPasswordLogin && !policy.enforceSsoOnly, developer: policy.allowDeveloperLogin === true && !policy.requireMfa };
}
