import { BadRequestException } from '@nestjs/common';

export const ROUND_KEYS = ['l1', 'l2', 'l3'] as const;
const progressed = (row: Record<string, any>, round: string) =>
  ![null, undefined, 'PENDING'].includes(row[`${round}Status`]) || Boolean(row[`${round}Date`] || row[`${round}Remarks`] || row[`${round}Interviewer`]);

// The validator and persistence layer must evaluate exactly the same resulting state.
export function roundUpdate(existing: Record<string, any>, dto: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const round of ROUND_KEYS) for (const suffix of ['Status', 'Date', 'Remarks', 'Interviewer', 'Color']) {
    const key = `${round}${suffix}`;
    if (dto[key] !== undefined) data[key] = suffix === 'Status' ? dto[key] ?? 'PENDING' : dto[key];
  }
  let resetFrom = -1;
  for (let i = 0; i < ROUND_KEYS.length; i++) {
    const round = ROUND_KEYS[i];
    const status = data[`${round}Status`] ?? existing[`${round}Status`] ?? 'PENDING';
    if (status === 'PENDING' && data[`${round}Status`] !== undefined) {
      data[`${round}Date`] = null;
      data[`${round}Interviewer`] = null;
      data[`${round}Color`] = null;
    }
    if (existing[`${round}Status`] === 'CLEARED' && status !== 'CLEARED' &&
      ROUND_KEYS.slice(i + 1).some(next => progressed(existing, next))) {
      if (!dto.resetFollowingRounds || !dto.correctionReason?.trim()) {
        throw new BadRequestException('Confirm resetting later rounds and provide a correction reason.');
      }
      resetFrom = i;
      break;
    }
  }
  if (resetFrom >= 0) for (const round of ROUND_KEYS.slice(resetFrom + 1)) {
    if (dto[`${round}Status`] !== undefined && ![null, 'PENDING'].includes(dto[`${round}Status`])) {
      throw new BadRequestException('Later rounds must remain pending after correcting an earlier clearance.');
    }
    data[`${round}Status`] = 'PENDING';
    data[`${round}Date`] = null;
    data[`${round}Remarks`] = null;
    data[`${round}Interviewer`] = null;
    data[`${round}Color`] = null;
  }
  return data;
}
