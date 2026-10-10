import { createHash } from 'node:crypto';
import type { CandidateAssessment, AssessmentCriterion } from '../recruiter-submissions/tracker-contract';

export const ASSESSMENT_ENGINE = 'evidence-v1';
export interface AssessmentJob {
  skillsRequired?: string[]; secondarySkills?: string[]; expMin?: number | null; expMax?: number | null;
  city?: string | null; state?: string | null; country?: string | null; workMode?: string | null;
  degree?: string | null; noticePeriod?: string | null;
}
export interface AssessmentCandidate {
  skills?: string[]; rawText?: string | null; parsedJson?: unknown; totalExperienceYears?: unknown;
  rawCurrentLocation?: string | null; preferredLocations?: string[]; noticePeriodDays?: number | null;
}
export function normalizeTerm(value: string) { return value.toLowerCase().replace(/[^a-z0-9+#. ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : []; }
function unique(values: string[]) { return [...new Map(values.map(value => [normalizeTerm(value), value])).values()].filter(value => normalizeTerm(value)); }
function textEvidence(term: string, text: string) {
  const escaped = normalizeTerm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').exec(text);
  return match ? text.slice(Math.max(0, match.index - 65), match.index + match[0].length + 100).replace(/\s+/g, ' ').trim() : null;
}
export function assessCandidate(job: AssessmentJob, candidate: AssessmentCandidate): CandidateAssessment {
  let parsed: any = candidate.parsedJson;
  if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = null; } }
  const skills = unique([...strings(candidate.skills), ...strings(parsed?.skills)]);
  const candidateQualifications = unique([
    ...strings(parsed?.education?.degrees),
    ...(Array.isArray(parsed?.education_detailed) ? parsed.education_detailed : [])
      .flatMap((entry: unknown) => entry && typeof entry === 'object' &&
        typeof (entry as { degree?: unknown }).degree === 'string' ? [(entry as { degree: string }).degree.trim()] : []),
  ]).filter(value => value.length <= 300);
  const skillSet = new Set(skills.map(normalizeTerm));
  const text = typeof candidate.rawText === 'string' ? candidate.rawText : '';
  const primary = unique(strings(job.skillsRequired));
  const secondary = unique(strings(job.secondarySkills)).filter(skill => !primary.some(required => normalizeTerm(required) === normalizeTerm(skill)));
  const criteria: AssessmentCriterion[] = [];
  const parts: CandidateAssessment['breakdown'] = [];
  for (const [group, values] of [['primary', primary], ['secondary', secondary]] as const) {
    for (const skill of values) {
      const excerpt = textEvidence(skill, text);
      const profile = skillSet.has(normalizeTerm(skill));
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
    const remote = normalizeTerm(job.workMode || '') === 'remote';
    const local = !!city && !!current && new RegExp(`(^|[^a-z0-9])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(current);
    const preferred = !!city && strings(candidate.preferredLocations).some(place => normalizeTerm(place) === city);
    criteria.push({ key: 'location', category: 'location', requirement: [job.workMode, location].filter(Boolean).join(' · '),
      finding: remote || local || preferred ? 'EVIDENCE_FOUND' : 'NEEDS_CLARIFICATION',
      evidence: remote ? 'Job is remote; confirm any geographic restrictions.' : local ? `Current location: ${candidate.rawCurrentLocation}; confirm work-mode availability.` : preferred ? 'Job city is listed as a preferred location; confirm relocation.' : 'Location or work-mode availability needs confirmation.' });
    parts.push({ label: 'Location', weight: 15, score: remote || local ? 100 : preferred ? 90 : null });
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
    engine: ASSESSMENT_ENGINE, version: createHash('sha256').update(JSON.stringify({ engine: ASSESSMENT_ENGINE, job, candidate })).digest('hex'),
    calculatedAt: new Date().toISOString(), score: measuredWeight ? Math.round(measured.reduce((sum, part) => sum + part.score! * part.weight, 0) / measuredWeight) : null,
    coverage: possibleWeight ? Math.round(measuredWeight / possibleWeight * 100) : 0, criteria, breakdown: parts, candidateQualifications,
    candidateSnapshot: {
      experienceYears: years != null && Number.isFinite(years) && years >= 0 ? years : null,
      noticePeriodDays: candidate.noticePeriodDays != null && Number.isFinite(candidate.noticePeriodDays) && candidate.noticePeriodDays >= 0 ? candidate.noticePeriodDays : null,
      currentLocation: candidate.rawCurrentLocation?.trim() || null,
    },
    limitations: ['Evidence score is not a hiring recommendation.', 'Missing evidence is not a confirmed failure.', 'Salary is excluded because candidate CTC currency and pay period are not established.', 'Semantic scoring is unavailable until parser search supports tenant isolation.'],
  };
  return result;
}
