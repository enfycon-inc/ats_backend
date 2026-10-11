export interface AssessmentSkill { id: number; canonicalName: string; aliases: { aliasName: string }[] }

// One projected read per assessment/batch, including transaction-time version checks.
export async function loadAssessmentSkills(db: Pick<PrismaClient, 'skillMaster'>): Promise<AssessmentSkill[]> {
  return db.skillMaster.findMany({ select: { id: true, canonicalName: true, aliases: { select: { aliasName: true } } }, orderBy: { id: 'asc' } });
}

export function skillTerm(value: string) {
  return value.toLowerCase().replace(/^\s*(?:programming|frontend|backend|database|tools)\s*:\s*/i, '')
    .replace(/\((?:basic[s]?|advanced|intermediate|beginner)\)/gi, '').replace(/\s+/g, ' ').trim();
}

export function skillResolver(dictionary: AssessmentSkill[]) {
  const ids = new Map<string, Set<number>>();
  for (const row of dictionary) for (const term of [row.canonicalName, ...row.aliases.map(alias => alias.aliasName)]) {
    const key = skillTerm(term);
    if (!key) continue;
    if (!ids.has(key)) ids.set(key, new Set());
    ids.get(key)!.add(row.id);
  }
  const resolve = (value: string) => {
    const key = skillTerm(value); const matches = ids.get(key);
    return matches?.size === 1 ? `skill:${[...matches][0]}` : `literal:${key}`;
  };
  const terms = (value: string) => {
    const identity = resolve(value);
    const row = dictionary.find(skill => `skill:${skill.id}` === identity);
    return [...new Set([skillTerm(value), ...(row ? [row.canonicalName, ...row.aliases.map(alias => alias.aliasName)].filter(term => resolve(term) === identity).map(skillTerm) : [])])].filter(Boolean);
  };
  return { resolve, terms };
}
import type { PrismaClient } from '@prisma/client';

