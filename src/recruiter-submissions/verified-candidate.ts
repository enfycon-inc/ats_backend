import { BadRequestException, ForbiddenException } from '@nestjs/common';

export function verifiedCandidateInput(value: unknown, updateSkills: unknown, permissions: string[] = []) {
  if (updateSkills !== undefined && typeof updateSkills !== 'boolean') throw new BadRequestException('Invalid profile update option.');
  if (updateSkills && !permissions.includes('candidate:edit')) throw new ForbiddenException('Candidate edit permission is required to update profile skills.');
  if (value === undefined) {
    if (updateSkills) throw new BadRequestException('Verified candidate details are required.');
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Invalid verified candidate details.');
  const input = value as Record<string, unknown>;
  const result: Record<string, string | string[]> = {};
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'totalExperienceYears', 'relevantExperienceYears', 'currentCompany', 'currentLocation', 'preferredLocations', 'noticePeriodDays', 'availabilityToStart']) {
    if (typeof input[key] !== 'string' || (input[key] as string).length > 1000) throw new BadRequestException('Invalid verified candidate details.');
    result[key] = (input[key] as string).trim();
  }
  if (!Array.isArray(input.skills) || !input.skills.length || input.skills.length > 100 || input.skills.some(skill => typeof skill !== 'string' || !skill.trim() || skill.length > 100)) throw new BadRequestException('Enter valid verified primary skills.');
  result.skills = [...new Set((input.skills as string[]).map(skill => skill.trim()))];
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'currentCompany', 'currentLocation', 'preferredLocations']) {
    if (!(result[key] as string).length) throw new BadRequestException('Complete required verified candidate details.');
  }
  for (const key of ['totalExperienceYears', 'relevantExperienceYears']) {
    if (!/^\d+(?:\.\d+)?$/.test(result[key] as string) || Number(result[key]) > 100) throw new BadRequestException('Enter valid experience years.');
  }
  if (Number(result.relevantExperienceYears) > Number(result.totalExperienceYears)) throw new BadRequestException('Relevant experience cannot exceed total experience.');
  if (!/^\d+$/.test(result.noticePeriodDays as string)) throw new BadRequestException('Enter valid notice period days.');
  return result;
}
