/** Canonical profile API contract. Mirrored in the web client profile-contract.ts. */
export interface ProfileDetailsInput {
  fullName: string;
  phone: string;
  designation?: string;
}
export interface AssignedProfileRole { id: string; name: string; systemRole?: string | null; }
export interface StaffProfile {
  [key: string]: unknown;
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  designation: string | null;
  city: string | null;
  avatar: string | null;
  profilePicture: string | null;
  assignedRoles: AssignedProfileRole[];
  roleId?: string | null;
  assignedRoleIds?: string[];
  roleName?: string | null;
  systemRole?: string | null;
  activeRoleId?: string | null;
  podId?: string | null;
  podName?: string | null;
  branchName: string | null;
  businessUnitName: string | null;
  features?: { podsEnabled: boolean };
  tenantId: string;
  tenantDomain: string;
  tenant: { name: string; domain: string; siteTitle: string; logoUrl: string; loginLogoUrl: string; compactLogoUrl?: string; };
  defaultMarket: string;
}
export interface EmailSignature { id: string; name: string; html: string; }
export interface SignatureSettings {
  signatures: EmailSignature[];
  newMessageSignatureId: string | null;
  replySignatureId: string | null;
}
export interface SignatureInput { id: string; name: string; html: string; }
export interface SignatureDefaultsInput {
  newMessageSignatureId: string | null;
  replySignatureId: string | null;
}
