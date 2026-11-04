import { deliveryCatalogPredicate } from './delivery-job-filters';
describe('Dashboard-to-catalog scope',()=>{
  const actor:any={tenantId:'tenant',branchId:'branch',businessUnitId:'unit',permissions:['unit_admin:manage','user:manage']};
  it('binds unit, city and local period without interpolating values',()=>{
    const values:any[]=[];const sql=deliveryCatalogPredicate(actor,{period:'month',cities:'VIZAG'},value=>{values.push(value);return '$'+values.length;});
    expect(values).toEqual(expect.arrayContaining(['tenant','branch','unit','month',['VIZAG']]));
    expect(sql).toContain('poster.is_approved=true');
    expect(sql).toContain('poster.business_unit_id=');
    expect(sql).toContain('AT TIME ZONE tz');
    expect(sql).not.toContain('VIZAG');
  });
  it('rejects missing unit access, unauthorized city comparisons and invalid periods',()=>{
    expect(()=>deliveryCatalogPredicate({...actor,permissions:[]},{},()=>'?')).toThrow();
    expect(()=>deliveryCatalogPredicate({...actor,permissions:['unit_admin:manage']},{cities:'VIZAG'},()=>'?')).toThrow();
    expect(()=>deliveryCatalogPredicate(actor,{period:'invalid'},()=>'?')).toThrow();
  });
});
