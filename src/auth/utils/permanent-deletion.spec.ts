import { assertPermanentDeletion } from './permanent-deletion';

describe('permanent deletion authorization', () => {
  it('allows tenant administration within its tenant', () => {
    expect(() => assertPermanentDeletion({ tenantId: 'a', permissions: ['tenant:settings'] }, 'a')).not.toThrow();
  });
  it('rejects another tenant even with tenant administration permission', () => {
    expect(() => assertPermanentDeletion({ tenantId: 'a', permissions: ['tenant:settings'] }, 'b')).toThrow();
  });
  it.each([['job:edit'], ['submission:edit'], ['user:manage'], ['']])('rejects ordinary staff capabilities %s', (permission) => {
    expect(() => assertPermanentDeletion({ tenantId: 'a', permissions: [permission] }, 'a')).toThrow();
  });
});
