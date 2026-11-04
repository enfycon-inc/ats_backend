import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { validateDeliveryPeriod } from './delivery-analytics';
export const deliveryJobStatusSql = "CASE WHEN UPPER(j.status) IN ('HOLD','ON HOLD') THEN 'HOLD' WHEN UPPER(j.status)='CLOSE' THEN 'CLOSED' ELSE UPPER(j.status) END";
export const deliveryJobPrioritySql = "CASE WHEN UPPER(j.urgency) IN ('URGENT','HIGH') THEN 'HOT' WHEN UPPER(j.urgency)='MEDIUM' THEN 'WARM' WHEN UPPER(j.urgency)='LOW' THEN 'COLD' ELSE UPPER(j.urgency) END";
export const deliveryJobTypeSql = "CASE WHEN LOWER(j.job_type) IN ('full-time','full time') THEN 'Full-Time' WHEN LOWER(j.job_type) IN ('contract','contractual') THEN 'Contractual' WHEN LOWER(j.job_type) IN ('c2h','contract-to-hire','contract to hire') THEN 'Contract-to-hire' ELSE j.job_type END";
export function deliveryCatalogPredicate(actor: AuthUser | undefined, query: Record<string,string>, bind:(value:string | number | string[])=>string) {
  if (!actor?.permissions?.includes('unit_admin:manage') || !actor.branchId || !actor.businessUnitId || !actor.tenantId) throw new ForbiddenException('A current unit dashboard assignment is required.');
  if (query.cities && !actor.permissions.includes('user:manage')) throw new ForbiddenException('User management permission is required for staff city comparisons.');
  const {period,cities}=validateDeliveryPeriod({period:query.period||'all',from:query.deliveryFrom||'',to:query.deliveryTo||'',cities:query.cities||''});
  const tenant=bind(actor.tenantId),branch=bind(actor.branchId),unit=bind(actor.businessUnitId);
  const preset=bind(period),from=bind(query.deliveryFrom||''),to=bind(query.deliveryTo||'');
  return ` AND j.branch_id=${branch}::uuid AND j.business_unit_id=${unit}::uuid AND EXISTS (
    SELECT 1 FROM (SELECT COALESCE(bu.timezone,b.timezone,'Asia/Kolkata') AS tz FROM ats.business_units bu JOIN ats.branches b ON b.id=bu.branch_id AND b.tenant_id=bu.tenant_id
      WHERE bu.id=${unit}::uuid AND bu.tenant_id=${tenant}::uuid AND b.id=${branch}::uuid) settings
    CROSS JOIN LATERAL (SELECT NOW() AT TIME ZONE tz AS clock) local_clock
    CROSS JOIN LATERAL (SELECT
      (CASE ${preset} WHEN 'today' THEN clock::date WHEN 'week' THEN date_trunc('week',clock)::date WHEN 'month' THEN date_trunc('month',clock)::date
        WHEN 'previousMonth' THEN (date_trunc('month',clock)-INTERVAL '1 month')::date WHEN 'year' THEN date_trunc('year',clock)::date WHEN 'previousYear' THEN (date_trunc('year',clock)-INTERVAL '1 year')::date WHEN 'custom' THEN NULLIF(${from},'')::date ELSE NULL END)::timestamp AT TIME ZONE tz AS start_at,
      (CASE ${preset} WHEN 'previousMonth' THEN date_trunc('month',clock)::date WHEN 'previousYear' THEN date_trunc('year',clock)::date WHEN 'custom' THEN NULLIF(${to},'')::date+1 WHEN 'all' THEN NULL ELSE clock::date+1 END)::timestamp AT TIME ZONE tz AS end_at) bounds
    WHERE start_at IS NULL OR (j.created_at>=start_at AND j.created_at<end_at))
    ${cities.length?` AND EXISTS (SELECT 1 FROM ats.users poster WHERE poster.id=j.created_by_user_id AND poster.tenant_id=${tenant}::uuid AND poster.branch_id=${branch}::uuid AND poster.business_unit_id=${unit}::uuid AND poster.is_approved=true AND COALESCE(poster.city::text,'UNSPECIFIED')=ANY(${bind(cities)}::text[]))`:''}`;
}
