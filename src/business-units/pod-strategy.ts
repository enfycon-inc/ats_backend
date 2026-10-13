import { BadRequestException } from '@nestjs/common';

export function normalizePodStrategy(value?: string | null): 'AUTO' | 'MANUAL' {
  if (value != null && typeof value !== 'string') throw new BadRequestException('Select a valid pod distribution strategy.');
  const strategy = (value || 'AUTO').trim().toUpperCase();
  if (['AUTO', 'AUTOMATIC', 'AUTO_ROUND_ROBIN'].includes(strategy)) return 'AUTO';
  if (strategy === 'MANUAL') return 'MANUAL';
  throw new BadRequestException('Select a valid pod distribution strategy.');
}

export function usesAutomaticPods(policy?: { allowPods?: boolean; podDistributionStrategy?: string | null } | null) {
  return policy?.allowPods === true && normalizePodStrategy(policy.podDistributionStrategy) === 'AUTO';
}
