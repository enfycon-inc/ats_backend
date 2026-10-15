import type { Prisma } from '@prisma/client';
import type { DeliveryPipeline, DeliveryStage } from './delivery-dashboard.contract';
import { currentTrackerRound } from '../recruiter-submissions/tracker-workflow';

export function deliveryStage(row: { finalStatus: string; l1Status: string; l2Status: string | null; l3Status: string | null }): DeliveryStage {
  if (row.finalStatus === 'PENDING_APPROVAL') return 'review';
  if (['REJECTED', 'NOT_SELECTED', 'WITHDRAWN'].includes(row.finalStatus)) return 'closed';
  if (['SELECTED', 'OFFER', 'JOIN'].includes(row.finalStatus)) return 'final';
  return currentTrackerRound(row) || 'final';
}

export function deliveryStageWhere(stage: DeliveryStage): Prisma.RecruiterSubmissionWhereInput {
  // Include legacy in-progress outcomes (for example POD_APPROVED) consistently
  // with deliveryStage, which lets explicit approval/terminal outcomes win first.
  const active = { finalStatus: { notIn: ['PENDING_APPROVAL', 'REJECTED', 'NOT_SELECTED', 'WITHDRAWN', 'SELECTED', 'OFFER', 'JOIN'] } };
  if (stage === 'review') return { finalStatus: 'PENDING_APPROVAL' };
  if (stage === 'closed') return { finalStatus: { in: ['REJECTED', 'NOT_SELECTED', 'WITHDRAWN'] } };
  if (stage === 'l1') return { ...active, l1Status: { not: 'CLEARED' } };
  if (stage === 'l2') return { ...active, l1Status: 'CLEARED', OR: [{ l2Status: null }, { l2Status: { not: 'CLEARED' } }] };
  if (stage === 'l3') return { ...active, l1Status: 'CLEARED', l2Status: 'CLEARED', OR: [{ l3Status: null }, { l3Status: { not: 'CLEARED' } }] };
  if (stage === 'final') return { OR: [{ finalStatus: { in: ['SELECTED', 'OFFER', 'JOIN'] } }, { ...active, l1Status: 'CLEARED', l2Status: 'CLEARED', l3Status: 'CLEARED' }] };
  return {};
}

export function aggregateDeliveryPipeline(rows: { finalStatus: string; l1Status: string; l2Status: string | null; l3Status: string | null; _count: { _all: number } }[]): DeliveryPipeline {
  const round = () => ({ pending: 0, scheduled: 0, feedback: 0, cancelled: 0 });
  const result: DeliveryPipeline = { total: 0, review: 0, l1: 0, l2: 0, l3: 0, final: 0, closed: 0, decision: 0, selected: 0, offers: 0, joined: 0, scheduled: 0, rounds: { l1: round(), l2: round(), l3: round() } };
  for (const row of rows) {
    const count = row._count._all;
    result.total += count;
    const stage = deliveryStage(row);
    if (stage !== 'all') result[stage] += count;
    if (stage === 'final') {
      const key = row.finalStatus === 'JOIN' ? 'joined' : row.finalStatus === 'OFFER' ? 'offers' : row.finalStatus === 'SELECTED' ? 'selected' : 'decision';
      result[key] += count;
    }
    if (stage === 'l1' || stage === 'l2' || stage === 'l3') {
      const status = row[`${stage}Status`];
      const key = status === 'SCHEDULED' ? 'scheduled' : status === 'AWAITING_FEEDBACK' ? 'feedback' : status === 'CANCELLED' ? 'cancelled' : 'pending';
      result.rounds[stage][key] += count;
      if (key === 'scheduled') result.scheduled += count;
    }
  }
  return result;
}
