import { aggregateDeliveryPipeline, deliveryStage, deliveryStageWhere } from './delivery-pipeline';

describe('Delivery interview pipeline', () => {
  const row = (finalStatus = 'SUBMITTED', l1Status = 'PENDING', l2Status: string | null = 'PENDING', l3Status: string | null = 'PENDING') => ({ finalStatus, l1Status, l2Status, l3Status });
  it('counts each submission once in its current round, ignoring default pending later rounds', () => {
    expect(deliveryStage(row())).toBe('l1');
    expect(deliveryStage(row('SUBMITTED', 'CLEARED', null, null))).toBe('l2');
    expect(deliveryStage(row('SUBMITTED', 'CLEARED', 'CLEARED'))).toBe('l3');
    expect(deliveryStage(row('SUBMITTED', 'CLEARED', 'CLEARED', 'CLEARED'))).toBe('final');
  });
  it('prioritizes approvals and final outcomes, including documented bypasses', () => {
    expect(deliveryStage(row('PENDING_APPROVAL'))).toBe('review');
    for (const status of ['SELECTED', 'OFFER', 'JOIN']) expect(deliveryStage(row(status))).toBe('final');
    for (const status of ['REJECTED', 'NOT_SELECTED', 'WITHDRAWN']) expect(deliveryStage(row(status))).toBe('closed');
    expect(deliveryStage(row('SUBMITTED', 'CLEARED', 'CANCELLED'))).toBe('l2');
  });
  it('aggregates grouped counts without counting passed or cancelled interviews as scheduled', () => {
    const rows = [row(), row('SUBMITTED', 'CLEARED', 'SCHEDULED'), row('SUBMITTED', 'CLEARED', 'CLEARED', 'AWAITING_FEEDBACK'), row('JOIN'), row('PENDING_APPROVAL'), row('NOT_SELECTED')];
    const result = aggregateDeliveryPipeline(rows.map(value => ({ ...value, _count: { _all: 2 } })));
    expect(result.total).toBe(12);
    expect(result.l1 + result.l2 + result.l3 + result.final + result.review + result.closed).toBe(12);
    expect(result.scheduled).toBe(2);
    expect(result.joined).toBe(2);
    expect(result.rounds.l3.feedback).toBe(2);
  });
  it('uses matching current-stage predicates for drilldowns', () => {
    const active = { finalStatus: { notIn: ['PENDING_APPROVAL', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'SELECTED', 'OFFER', 'JOIN'] } };
    expect(deliveryStage(row('POD_APPROVED'))).toBe('l1');
    expect(deliveryStageWhere('l2')).toEqual({ ...active, l1Status: 'CLEARED', OR: [{ l2Status: null }, { l2Status: { not: 'CLEARED' } }] });
    expect(deliveryStageWhere('review')).toEqual({ finalStatus: 'PENDING_APPROVAL' });
    expect(deliveryStageWhere('final')).toEqual({ OR: [{ finalStatus: { in: ['SELECTED', 'OFFER', 'JOIN'] } }, { ...active, l1Status: 'CLEARED', l2Status: 'CLEARED', l3Status: 'CLEARED' }] });
  });
});
