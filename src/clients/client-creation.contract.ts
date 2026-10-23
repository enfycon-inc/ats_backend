// Source of truth; sync the frontend copy with scripts/sync-client-creation-contract.cjs.
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export const POC_DESIGNATIONS = ['HR Executive', 'HR Manager', 'HR Head', 'Talent Acquisition Specialist', 'Talent Acquisition Manager', 'Hiring Manager', 'Procurement Manager', 'Vendor Manager', 'VMS Lead', 'Other'] as const;
export interface ClientContactInput {
  firstName?: string;
  lastName?: string;
  /** Legacy full names remain accepted; never split historical names automatically. */
  name?: string;
  designation?: string;
  otherDesignation?: string;
  email?: string;
  phone?: string;
}
export function contactInputErrors(input: ClientContactInput, requireEmail = true): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { contact: 'Enter valid contact details.' };
  for (const key of ['firstName', 'lastName', 'name', 'designation', 'otherDesignation', 'email', 'phone'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key]!.length > (key === 'phone' ? 50 : 255))) errors[key] = 'Enter a valid contact value.';
  }
  if (Object.keys(errors).length) return errors;
  const structured = input.firstName !== undefined || input.lastName !== undefined;
  if (structured ? !input.firstName?.trim() : !input.name?.trim()) errors.firstName = 'Enter the contact’s first name.';
  const name = structured ? [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ') : input.name?.trim() || '';
  if (name.length > 255) errors.firstName = 'The full contact name must be at most 255 characters.';
  if ((requireEmail || input.email?.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email?.trim() || '')) errors.email = 'Enter a valid work email.';
  if (input.designation === 'Other' && !input.otherDesignation?.trim()) errors.otherDesignation = 'Specify the contact’s designation.';
  if (input.phone?.trim()) {
    const phone = input.phone.trim().startsWith('+') ? parsePhoneNumberFromString(input.phone.trim()) : undefined;
    if (!phone?.isValid()) errors.phone = 'Enter a valid mobile number including its country code.';
  }
  return errors;
}
export function normalizeContactInput(input: ClientContactInput) {
  const structured = input.firstName !== undefined || input.lastName !== undefined;
  return {
    name: structured ? [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ') : input.name?.trim() || '',
    designation: (input.designation === 'Other' ? input.otherDesignation : input.designation)?.trim() || undefined,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() ? parsePhoneNumberFromString(input.phone.trim())?.number : undefined,
  };
}
export const CLIENT_CATEGORIES = ['Direct employer', 'Staffing vendor', 'Implementation partner', 'MSP'] as const;
export type ClientMarket = 'INDIA' | 'US';
export function normalizeClientName(name: string): string {
  return name.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
    .replace(/\b(inc|llc|corp|corporation|ltd|limited|co|company|pvt|private)\b/g, '').replace(/\s+/g, '').trim();
}
export function normalizeClientMarket(value: unknown): ClientMarket | undefined {
  const code = String(value || '').trim().toUpperCase();
  if (['IN', 'IND', 'INDIA'].includes(code)) return 'INDIA';
  if (['US', 'USIT', 'USA'].includes(code)) return 'US';
  return undefined;
}
export interface ClientCreationContext {
  branchId: string;
  branchName: string;
  businessUnitId: string | null;
  businessUnitName: string | null;
  ownerId: string;
  ownerName: string;
  market: ClientMarket;
  currency: 'INR' | 'USD';
  canDirectAdd: boolean;
}
export interface ClientCreationRequest {
  request_id: string;
  client_name: string;
  category: typeof CLIENT_CATEGORIES[number];
  branch_id: string;
  business_unit_id: string | null;
  market: ClientMarket;
  currency: 'INR' | 'USD';
  client_short_name?: string;
  email_id?: string;
  website?: string;
  industry?: string;
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  postal_code?: string;
  about_company?: string;
  payment_terms?: string;
  commission_percentage?: number;
  gstin?: string;
  pan_number?: string;
  federal_id?: string;
  msa_signed?: boolean;
  sow_executed?: boolean;
  coi_received?: boolean;
  vendor_portal_created?: boolean;
  tier_rating?: string;
  credit_check_status?: string;
  fillability_score?: string;
  vetting_notes?: string;
  contact?: ClientContactInput;
}
export interface CreatedClient {
  id: string;
  client_name: string;
  market: ClientMarket;
  currency: string;
  status: string;
  approval_status: string;
  commission_percentage?: number | string | null;
}
export function clientCreationErrors(input: Partial<ClientCreationRequest>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { form: 'Enter valid client details.' };
  const lengths: Record<string, number> = { client_name: 255, client_short_name: 100, email_id: 255, website: 255, industry: 100,
    country: 100, state: 100, city: 100, address: 2000, postal_code: 50, about_company: 10000, payment_terms: 100,
    gstin: 100, pan_number: 100, federal_id: 100, vetting_notes: 10000, tier_rating: 50, credit_check_status: 50, fillability_score: 50 };
  for (const [key, max] of Object.entries(lengths)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > max)) errors[key] = `Enter valid ${key.replace(/_/g, ' ')} (maximum ${max} characters).`;
  }
  for (const key of ['msa_signed', 'sow_executed', 'coi_received', 'vendor_portal_created']) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined && typeof value !== 'boolean') errors[key] = 'Agreement values must be enabled or disabled.';
  }
  if (Object.keys(errors).length) return errors;
  if (!input.client_name?.trim() || input.client_name.trim().length > 255) errors.client_name = 'Enter a legal company name (maximum 255 characters).';
  if (!CLIENT_CATEGORIES.includes(input.category!)) errors.category = 'Select a client category.';
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (input.email_id && (!email.test(input.email_id) || input.email_id.length > 255)) errors.email_id = 'Enter a valid company email.';
  if (input.website && !/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(input.website)) errors.website = 'Enter a website starting with https:// or http://.';
  if (input.commission_percentage !== undefined && (!Number.isFinite(input.commission_percentage) || input.commission_percentage < 0 || input.commission_percentage > 100)) errors.commission_percentage = 'Commission must be between 0 and 100.';
  if (input.contact) {
    const contactErrors = contactInputErrors(input.contact);
    if (Object.keys(contactErrors).length) {
      errors.contact = Object.values(contactErrors)[0];
      for (const [key, message] of Object.entries(contactErrors)) errors[`contact.${key}`] = message;
    }
  }
  const choices = { tier_rating: ['TIER_1', 'TIER_2', 'TIER_3'], credit_check_status: ['PENDING_CHECK', 'APPROVED', 'HIGH_RISK'], fillability_score: ['HIGH', 'MEDIUM', 'LOW'] };
  for (const [key, options] of Object.entries(choices)) {
    const value = input[key as keyof typeof choices];
    if (value && !options.includes(value)) errors[key] = 'Select a valid qualification value.';
  }
  if (input.market === 'INDIA' && input.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(input.gstin)) errors.gstin = 'Enter a valid 15-character GSTIN.';
  if (input.market === 'INDIA' && input.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.pan_number)) errors.pan_number = 'Enter a valid PAN.';
  return errors;
}
