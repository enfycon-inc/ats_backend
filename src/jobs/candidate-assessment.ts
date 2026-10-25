import { createHash } from 'node:crypto';
import type { CandidateAssessment, AssessmentCriterion } from '../recruiter-submissions/tracker-contract';
import { AssessmentSkill, skillResolver } from './assessment-skill-dictionary';

export const ASSESSMENT_ENGINE = 'dictionary-v2';
export interface AssessmentJob {
  skillsRequired?: string[]; secondarySkills?: string[]; expMin?: number | null; expMax?: number | null;
  city?: string | null; state?: string | null; country?: string | null; workMode?: string | null;
  degree?: string | null; noticePeriod?: string | null;
}
export interface AssessmentCandidate {
  skills?: string[]; rawText?: string | null; parsedJson?: unknown; totalExperienceYears?: unknown;
  rawCurrentLocation?: string | null; preferredLocations?: string[]; preferredLocationMode?: 'SPECIFIC_LOCATIONS' | 'REMOTE_ONLY' | 'REMOTE_OR_LOCATIONS' | null; noticePeriodDays?: number | null;
}
export function assessmentSourceVersion(job: AssessmentJob & { id?: string; updatedAt?: Date | string | null }, candidate: AssessmentCandidate & {
  id?: string; updatedAt?: Date | string | null; resumeRecordId?: string | null;
  resumeRecord?: { id?: string | null; fileHash?: string | null } | null;
}, dictionary: AssessmentSkill[] = []) {
  const stableDictionary = dictionary.map(row => ({
    id: row.id,
    canonicalName: row.canonicalName,
    aliases: [...row.aliases].map(alias => alias.aliasName).sort(),
  })).sort((a, b) => a.id - b.id);
  return createHash('sha256').update(JSON.stringify({
    engine: ASSESSMENT_ENGINE,
    job: {
      id: job.id, updatedAt: job.updatedAt,
      skillsRequired: job.skillsRequired, secondarySkills: job.secondarySkills,
      expMin: job.expMin, expMax: job.expMax, city: job.city, state: job.state,
      country: job.country, workMode: job.workMode, degree: job.degree, noticePeriod: job.noticePeriod,
    },
    candidate: {
      id: candidate.id, updatedAt: candidate.updatedAt,
      resumeRecordId: candidate.resumeRecordId || candidate.resumeRecord?.id || null,
      resumeFileHash: candidate.resumeRecord?.fileHash || null,
      skills: candidate.skills,
      totalExperienceYears: candidate.totalExperienceYears,
      rawCurrentLocation: candidate.rawCurrentLocation,
      preferredLocations: candidate.preferredLocations,
      preferredLocationMode: candidate.preferredLocationMode,
      noticePeriodDays: candidate.noticePeriodDays,
    },
    dictionary: stableDictionary,
  })).digest('hex');
}
export function normalizeTerm(value: string) { return value.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []; }
function unique(values: string[]) { return [...new Map(values.map(value => [normalizeTerm(value), value])).values()].filter(value => normalizeTerm(value)); }
function textEvidence(term: string, text: string) {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i').exec(text);
  return match ? text.slice(Math.max(0, match.index - 65), match.index + match[0].length + 100).replace(/\s+/g, ' ').trim() : null;
}
export function assessCandidate(job: AssessmentJob, candidate: AssessmentCandidate, dictionary: AssessmentSkill[] = [], versionOverride?: string): CandidateAssessment {
  let parsed: any = candidate.parsedJson;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  const skills = unique([...strings(candidate.skills), ...strings(parsed?.skills),
    ...(Array.isArray(parsed?.skills_detailed) ? parsed.skills_detailed : []).flatMap((entry: unknown) => entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string' ? [(entry as { name: string }).name] : []),
  ]);
  const resolver = skillResolver(dictionary);
  const candidateQualifications = unique([
    ...strings(parsed?.education?.degrees),
    ...(Array.isArray(parsed?.education_detailed) ? parsed.education_detailed : [])
      .flatMap((entry: unknown) => entry && typeof entry === 'object' &&
        typeof (entry as { degree?: unknown }).degree === 'string' ? [(entry as { degree: string }).degree.trim()] : []),
  ]).filter(value => value.length <= 300);
  const skillSet = new Set(skills.map(resolver.resolve));
  const text = typeof candidate.rawText === 'string' ? candidate.rawText : '';
  const canonicalUnique = (values: string[]) => [...new Map(values.map(value => [resolver.resolve(value), value])).values()];
  const primary = canonicalUnique(unique(strings(job.skillsRequired)));
  const secondary = canonicalUnique(unique(strings(job.secondarySkills))).filter(skill => !primary.some(required => resolver.resolve(required) === resolver.resolve(skill)));
  const criteria: AssessmentCriterion[] = [];
  const parts: CandidateAssessment['breakdown'] = [];
  for (const [group, values] of [['primary', primary], ['secondary', secondary]] as const) {
    for (const skill of values) {
      const excerpt = resolver.terms(skill).map(term => textEvidence(term, text)).find(Boolean);
      const profile = skillSet.has(resolver.resolve(skill));
      criteria.push({ key: `${group}:${normalizeTerm(skill)}`, requirement: skill, category: group,
        finding: excerpt || profile ? 'EVIDENCE_FOUND' : text || skills.length ? 'NO_EVIDENCE' : 'NEEDS_CLARIFICATION',
        evidence: excerpt ? `Resume: “${excerpt}”` : profile ? `Listed in candidate profile or parsed resume: ${skill}` : 'No supporting evidence found. This is not a confirmed failure.' });
    }
    if (values.length) {
      const found = criteria.filter(row => row.category === group && row.finding === 'EVIDENCE_FOUND').length;
      parts.push({ label: group === 'primary' ? 'Required skills' : 'Additional skills', weight: group === 'primary' ? 45 : 10,
        score: text || skills.length ? Math.round(found / values.length * 100) : null });
    }
  }
  const years = candidate.totalExperienceYears == null ? null : Number(candidate.totalExperienceYears);
  if (job.expMin != null || job.expMax != null) {
    const known = years != null && Number.isFinite(years) && years >= 0;
    const meets = known && (job.expMin == null || years >= job.expMin);
    criteria.push({ key: 'experience', category: 'experience', requirement: `Experience: ${job.expMin ?? '—'}–${job.expMax ?? '—'} years`,
      finding: !known ? 'NEEDS_CLARIFICATION' : meets ? 'MEETS' : 'DOES_NOT_MEET',
      evidence: known ? `${years} total years in profile; verify relevant experience. Above the range is not penalized.` : 'Experience not provided.' });
    parts.push({ label: 'Experience', weight: 15, score: !known ? null : meets ? 100 : Math.round(Math.max(0, years / (job.expMin || 1)) * 100) });
  }
  const location = [job.city, job.state, job.country].filter(Boolean).join(', ');
  if (location || job.workMode) {
    const city = normalizeTerm(job.city || '');
    const current = normalizeTerm(candidate.rawCurrentLocation || '');
    const jobWorkMode = normalizeTerm(job.workMode || '');
    const jobRemote = jobWorkMode === 'remote' || jobWorkMode === 'fully remote';
    const candidateRemoteOnly = candidate.preferredLocationMode === 'REMOTE_ONLY';
    const candidateRemoteOk = candidateRemoteOnly || candidate.preferredLocationMode === 'REMOTE_OR_LOCATIONS';
    const local = !!city && !!current && new RegExp(`(^|[^a-z0-9])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(current);
    const preferred = !!city && strings(candidate.preferredLocations).some(place => normalizeTerm(place) === city);
    const remoteConflict = candidateRemoteOnly && !jobRemote;
    const remoteMatch = jobRemote && candidateRemoteOk;
    criteria.push({ key: 'location', category: 'location', requirement: [job.workMode, location].filter(Boolean).join(' · '),
      finding: remoteConflict ? 'DOES_NOT_MEET' : remoteMatch || local || preferred ? 'EVIDENCE_FOUND' : 'NEEDS_CLARIFICATION',
      evidence: remoteConflict ? 'Candidate prefers remote-only work while this job is not remote.' : remoteMatch ? 'Candidate marked remote work as acceptable; confirm geographic restrictions.' : jobRemote ? 'Job is remote; confirm the candidate’s remote preference and any geographic restrictions.' : local ? `Current location: ${candidate.rawCurrentLocation}; confirm work-mode availability.` : preferred ? 'Job city is listed as a preferred location; confirm relocation.' : 'Location or work-mode availability needs confirmation.' });
    parts.push({ label: 'Location', weight: 15, score: remoteConflict ? 0 : remoteMatch || local ? 100 : preferred ? 90 : null });
  }
  if (job.degree) criteria.push({ key: 'degree', category: 'education', requirement: `Education: ${job.degree}`, finding: 'NEEDS_CLARIFICATION', evidence: 'Qualification equivalence requires reviewer confirmation.' });
  if (job.noticePeriod) {
    const match = /^(\d+)\s*(?:days?)?$/i.exec(job.noticePeriod.trim());
    const maximum = /^immediate$/i.test(job.noticePeriod.trim()) ? 0 : match ? Number(match[1]) : null;
    const days = candidate.noticePeriodDays;
    const known = maximum != null && days != null && Number.isFinite(days) && days >= 0;
    criteria.push({ key: 'notice', category: 'notice', requirement: `Notice: ${job.noticePeriod}`, finding: known ? days <= maximum ? 'MEETS' : 'DOES_NOT_MEET' : 'NEEDS_CLARIFICATION', evidence: days == null ? 'Candidate notice period not provided.' : `${days} days in profile; confirm availability.` });
    parts.push({ label: 'Notice period', weight: 10, score: known ? days <= maximum ? 100 : 0 : null });
  }
  const measured = parts.filter(part => part.score != null);
  const measuredWeight = measured.reduce((sum, part) => sum + part.weight, 0);
  const possibleWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const result: CandidateAssessment = {
    engine: ASSESSMENT_ENGINE, version: versionOverride || createHash('sha256').update(JSON.stringify({ engine: ASSESSMENT_ENGINE, job, candidate, dictionary: dictionary.map(row => ({ ...row, aliases: [...row.aliases].sort((a, b) => a.aliasName.localeCompare(b.aliasName)) })).sort((a, b) => a.id - b.id) })).digest('hex'),
    calculatedAt: new Date().toISOString(), score: measuredWeight ? Math.round(measured.reduce((sum, part) => sum + part.score! * part.weight, 0) / measuredWeight) : null,
    coverage: possibleWeight ? Math.round(measuredWeight / possibleWeight * 100) : 0, criteria, breakdown: parts, candidateQualifications,
    additionalCandidateSkills: skills.filter(skill => ![...primary, ...secondary].some(required => resolver.resolve(required) === resolver.resolve(skill))),
    candidateSnapshot: {
      experienceYears: years != null && Number.isFinite(years) && years >= 0 ? years : null,
      noticePeriodDays: candidate.noticePeriodDays != null && Number.isFinite(candidate.noticePeriodDays) && candidate.noticePeriodDays >= 0 ? candidate.noticePeriodDays : null,
      currentLocation: candidate.rawCurrentLocation?.trim() || null,
      preferredLocationMode: candidate.preferredLocationMode || null,
    },
    limitations: ['Evidence score is not a hiring recommendation.', 'Missing evidence is not a confirmed failure.', 'Salary is excluded because candidate CTC currency and pay period are not established.', 'Semantic scoring is unavailable until parser search supports tenant isolation.'],
  };
  return result;
}
