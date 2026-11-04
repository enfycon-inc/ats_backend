import {Prisma} from '@prisma/client';

/** Recorded results survive finalization; unresolved queues require an active workflow. */
export function deliveryRoundEligibility(round:'l1'|'l2'|'l3', alias:''|'s'='') {
  const column=(name:string)=>Prisma.raw(`${alias ? alias+'.' : ''}${name}`);
  const status=column(`${round}_status`), final=column('final_status');
  const reached=round==='l1' ? Prisma.sql`TRUE` : round==='l2' ? Prisma.sql`${column('l1_status')}='CLEARED'` : Prisma.sql`${column('l1_status')}='CLEARED' AND ${column('l2_status')}='CLEARED'`;
  const later=round==='l1' ? Prisma.sql`COALESCE(${column('l2_status')},'PENDING')='PENDING' AND COALESCE(${column('l3_status')},'PENDING')='PENDING'` : round==='l2' ? Prisma.sql`COALESCE(${column('l3_status')},'PENDING')='PENDING'` : Prisma.sql`TRUE`;
  return Prisma.sql`(${final}<>'PENDING_APPROVAL' AND (
    ${status} IN ('CLEARED','REJECTED','CANCELLED') OR (
      ${final} NOT IN ('SELECTED','OFFER','JOIN','REJECTED','NOT_SELECTED','WITHDRAWN')
      AND (${reached}) AND (${later})
    )
  ))`;
}
