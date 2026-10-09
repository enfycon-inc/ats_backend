import { JobsService } from './jobs.service';
import { normalizeJobStatus } from './job-status-contract';
const actor: any = { dbId: 'actor', email: 'actor@example.com', permissions: ['job:edit'], branchId: 'branch', businessUnitId: 'unit' };
function setup() {
 const job: any = { id: 'job', status: 'Active', approvalStatus: 'APPROVED', branchId: 'branch', businessUnitId: 'unit', updatedAt: new Date(), clientId: null };
 const tx: any = { job: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, auditLog: { create: jest.fn() } };
 const prisma: any = { job: { findFirst: jest.fn().mockResolvedValue(job) }, $transaction: jest.fn(fn => fn(tx)) };
 return { job, tx, service: new JobsService(prisma, {} as any) };
}
const payload = { status: 'Closed', expectedStatus: 'Active', reason: 'Client ended hiring' };
describe('job status changes', () => {
 it('normalizes legacy and uppercase values', () => { expect(normalizeJobStatus('ON_HOLD')).toBe('On Hold'); expect(normalizeJobStatus('Close')).toBe('Closed'); expect(normalizeJobStatus('invalid')).toBeNull(); });
 it('writes status and reason in the same transaction', async () => { const {service,tx}=setup(); await service.changeStatus('job',payload,'tenant',actor); expect(tx.job.updateMany).toHaveBeenCalled(); expect(tx.auditLog.create.mock.calls[0][0].data.details).toEqual({before:'Active',after:'Closed',reason:payload.reason}); });
 it.each(['permission','branch','unit','approval','stale','invalid'])('rejects %s without writing',async kind => {const {job,service,tx}=setup(); const user={...actor}; const data={...payload}; if(kind==='permission')user.permissions=[]; if(kind==='branch')job.branchId='foreign'; if(kind==='unit')job.businessUnitId='foreign'; if(kind==='approval')job.approvalStatus='PENDING_APPROVAL'; if(kind==='stale')data.expectedStatus='Filled';  if(kind==='invalid')data.status='unknown'; await expect(service.changeStatus('job',data,'tenant',user)).rejects.toThrow(); expect(tx.job.updateMany).not.toHaveBeenCalled(); });
 it('changes status without a comment and keeps the audit record', async () => { const {service,tx}=setup(); await service.changeStatus('job',{status:'Closed',expectedStatus:'Active'},'tenant',actor); expect(tx.auditLog.create.mock.calls[0][0].data.details).toEqual({before:'Active',after:'Closed'}); });
 it.each([42, 'x'.repeat(2001)])('rejects invalid optional reason %p', async reason => { const {service,tx}=setup(); await expect(service.changeStatus('job',{...payload,reason} as any,'tenant',actor)).rejects.toThrow(); expect(tx.job.updateMany).not.toHaveBeenCalled(); });
 it('rejects a concurrent edit before logging success', async () => {const {service,tx}=setup();tx.job.updateMany.mockResolvedValue({count:0});await expect(service.changeStatus('job',payload,'tenant',actor)).rejects.toThrow('Job changed');expect(tx.auditLog.create).not.toHaveBeenCalled();});
});
