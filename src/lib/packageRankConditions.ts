import type { ServiceRanks } from '@/data/ranks';
import type { PackageTemplateCondition } from './packageTemplateProgram';

/** Match free-text rank intake against one service's enlisted pay grades. */
export function enlistedGradeRange(questionId: string, service: ServiceRanks, min: number, max: number): PackageTemplateCondition {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 9 || min > max)
    throw new Error('Choose an enlisted pay grade range between E-1 and E-9.');
  const values = new Set<string>();
  for (const { ranks } of service.categories) {
    for (const { grade, title, abbrev } of ranks) {
      const level = /^E-(\d+)$/.exec(grade);
      if (!level || Number(level[1]) < min || Number(level[1]) > max) continue;
      for (const payGrade of [grade, grade.replace('-', '')]) {
        values.add(payGrade);
        for (const name of [abbrev, title]) {
          values.add(name);
          values.add(name + '/' + payGrade);
          values.add(name + ' ' + payGrade);
        }
      }
    }
  }
  if (!values.size) throw new Error('No enlisted ranks match the selected grades.');
  return { op: 'all', conditions: [
    { op: 'answered', questionId }, { op: 'matchesAny', questionId, values: [...values] },
  ] };
}
