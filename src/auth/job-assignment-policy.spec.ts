import { effectiveJobAssignmentPolicy } from './job-assignment-policy';
import { usesAutomaticPods } from '../business-units/pod-strategy';
describe('effective job assignment feature policy', () => {
  it.each([[false, true], [true, false], [false, false]])('disables pods and permits direct assignment when tenant=%s unit=%s', (tenant, unit) => {
    const saved = { allowPods: unit, allowNone: false, allowUnassigned: false, podDistributionStrategy: 'AUTO' };
    const result = effectiveJobAssignmentPolicy(saved, tenant)!;
    expect(result).toMatchObject({ allowPods: false, allowNone: true, allowUnassigned: false });
    expect(usesAutomaticPods(result)).toBe(false);
    expect(saved.allowNone).toBe(false);
  });
  it('preserves enabled unit restrictions and automatic strategy', () => {
    const result = effectiveJobAssignmentPolicy({ allowPods: true, allowNone: false, podDistributionStrategy: 'AUTO' }, true)!;
    expect(result.allowNone).toBe(false);
    expect(usesAutomaticPods(result)).toBe(true);
  });
  it('does not invent a policy for a missing unit', () => expect(effectiveJobAssignmentPolicy(null, true)).toBeNull());
});
