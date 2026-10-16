import { describe, it, expect } from 'vitest';
import { validateSkillEntries } from '@/lib/publicationSkills';

describe('publication skills and time', () => {
  it('requires a title and time for each supplied entry', () => {
    expect(validateSkillEntries([''])).toHaveLength(1);
    expect(validateSkillEntries(['Equipment technician'])).toHaveLength(1);
    expect(validateSkillEntries(['0.5 hours'])).toHaveLength(1);
    expect(validateSkillEntries(['Equipment technician, 0.5 hours; Electrician'])).toHaveLength(1);
    expect(validateSkillEntries(['Equipment technician, 0.5 hours', 'Electrician, 2 hours'])).toEqual([]);
  });
  it.each(['0', '-1', '0.25', '1/2'])('rejects %s hours', (time) => {
    expect(validateSkillEntries([`Equipment technician, ${time} hours`]).join(' ')).toContain('positive hours');
  });
  it.each(['0.1', '0.5', '1', '1.25'])('accepts %s hours', (time) => {
    expect(validateSkillEntries([`Equipment technician, ${time} hours`])).toEqual([]);
  });
});
