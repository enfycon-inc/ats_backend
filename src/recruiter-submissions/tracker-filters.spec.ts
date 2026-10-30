import {
  trackerFilterAccess,
  validateTrackerFilters,
  trackerPublicFilters,
} from './tracker-filters';
describe('submission filter capability policy', () => {
  it('accepts scoped explicit and matching multi-selections and rejects mixed or invalid modes',()=>{
    const access=trackerFilterAccess(['unit_admin:manage','client:view']);
    const id='00000000-0000-0000-0000-000000000101';
    expect(()=>validateTrackerFilters({accountManagers:{mode:'ids',ids:[id]},recruiters:{mode:'matching',search:'Alex',excludedIds:[]}},access)).not.toThrow();
    for(const selection of [null,{mode:'ids',ids:[]},{mode:'ids',ids:[id,id]},{mode:'ids',ids:['bad']},{mode:'matching',search:123},{mode:'other'}])expect(()=>validateTrackerFilters({accountManagers:selection} as any,access)).toThrow();
    expect(()=>validateTrackerFilters({accountManagerId:id,accountManagers:{mode:'ids',ids:[id]}},access)).toThrow('one selection mode');
    expect(()=>validateTrackerFilters({clients:{mode:'matching',search:''}},trackerFilterAccess(['submission:view']))).toThrow();
    expect(trackerPublicFilters({accountManagers:JSON.stringify({mode:'ids',ids:[id]})}).accountManagers).toEqual({mode:'ids',ids:[id]});
    expect(()=>trackerPublicFilters({clients:'not json'})).toThrow();
  });
  it('validates round inspection separately from current-stage filters and urgency aliases',()=>{
    const access=trackerFilterAccess(['unit_admin:manage']);
    expect(()=>validateTrackerFilters({round:'l1',roundStatus:'CLEARED' as any,bucket:'all'},access)).not.toThrow();
    expect(()=>validateTrackerFilters({round:'l1',stage:'l1'},access)).toThrow();
    expect(()=>validateTrackerFilters({roundStatus:'PENDING' as any},access)).toThrow();
    expect(()=>validateTrackerFilters({urgency:'Hot'},access)).not.toThrow();
    expect(()=>validateTrackerFilters({urgency:'Urgent'},access)).toThrow('Hot, Warm or Cold');
  });
  it('provides working presets from capabilities rather than role labels', () => {
    expect(trackerFilterAccess(['ACCOUNT_MANAGER']).portfolio).toBe(false);
    expect(trackerFilterAccess(['job:submit_owned_jobs'])).toMatchObject({
      portfolio: true,
      people: true,
      unit: false,
      branch: false,
    });
    expect(trackerFilterAccess(['unit_admin:manage'])).toMatchObject({
      people: true,
      unit: false,
      branch: false,
    });
    expect(trackerFilterAccess(['branch_admin:manage'])).toMatchObject({
      people: true,
      unit: true,
      branch: false,
    });
    expect(trackerFilterAccess(['submission:view'])).toMatchObject({
      people: false,
      clients: false,
      pods: false,
    });
  });
  it.each([
    { businessUnitId: '00000000-0000-0000-0000-000000000001' },
    { recruiterId: '00000000-0000-0000-0000-000000000001' },
    { clientId: '00000000-0000-0000-0000-000000000001' },
    { podId: '00000000-0000-0000-0000-000000000001' },
  ])('denies unauthorized scope selectors %j', (filters) => {
    expect(() =>
      validateTrackerFilters(filters, trackerFilterAccess(['submission:view'])),
    ).toThrow();
  });
  it.each([
    { stageStatus: 'PENDING' },
    { stage: 'review', stageStatus: 'PENDING' },
    { stage: 'l1', stageStatus: 'CLEARED' },
    { stage: 'review', bucket: 'interviews' },
    { dateBasis: 'joined', bucket: 'closed' },
    { startDate: '2026-02-30' },
    { interviewFrom: '2026-10-20', interviewTo: '2026-10-01' },
    { queue: 'invalid' },
    { accountManagerId: "' OR TRUE --" },
  ])('rejects ambiguous or invalid combinations %j', (filters) => {
    expect(() =>
      validateTrackerFilters(
        filters as any,
        trackerFilterAccess(['unit_admin:manage', 'client:view']),
      ),
    ).toThrow();
  });
  it('accepts separate current stage, historical round and closure date filters', () => {
    const access = trackerFilterAccess(['unit_admin:manage']);
    expect(() =>
      validateTrackerFilters(
        {
          stage: 'l2',
          stageStatus: 'PENDING',
          bucket: 'interviews',
          l1Status: 'CLEARED',
        },
        access,
      ),
    ).not.toThrow();
    expect(() =>
      validateTrackerFilters(
        {
          bucket: 'closures',
          dateBasis: 'joined',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
        },
        access,
      ),
    ).not.toThrow();
  });
  it('only accepts public fields and parses pagination without accepting internal query switches', () => {
    expect(
      trackerPublicFilters({
        filterOptions: 'clientId',
        optionSearch: 'secret',
        dashboardOnly: 'true',
        page: '2',
        limit: '10',
        stage: 'l1',
      }),
    ).toEqual({ page: 2, limit: 10, stage: 'l1' });
  });
});
