import { JOB_URGENCIES, normalizeJobUrgency } from './job-urgency-contract';
describe('shared job urgency',()=>{
  it('offers only the three supported labels',()=>expect(JOB_URGENCIES).toEqual(['Hot','Warm','Cold']));
  it.each([['HOT','Hot'],['warm','Warm'],['Cold','Cold'],['High','Hot'],['Urgent','Hot'],['Medium','Warm'],['Low','Cold'],['unknown',null],[null,null]])('normalizes %s without inventing an urgency', (value,expected)=>expect(normalizeJobUrgency(value)).toBe(expected));
});
