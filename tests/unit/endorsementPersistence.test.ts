import { describe, expect, it } from 'vitest';
import { parseSharedSession } from '@/lib/sharedSession';
import { validateBackupSession } from '@/lib/backupValidation';

const session = (additionalEndorsements?: unknown) => ({
  documentMode: 'compliant', documentCategory: 'correspondence', docType: 'naval_letter',
  formData: additionalEndorsements === undefined ? {} : { additionalEndorsements },
  paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [],
});

describe('endorsement import validation', () => {
  it('supports older documents and preserves all valid endorsement fields', () => {
    expect(() => validateBackupSession(session())).not.toThrow();
    expect(parseSharedSession(session()).formData.additionalEndorsements).toBeUndefined();
    const entries = [{ id: 'second', endorsementBody: 'Approved.', endorsementSigLast: 'REVIEWER',
      endorsementFrom: 'Reviewer', endorsementTo: 'Test Command', endorsementSerial: '0150', endorsementDate: '3 Nov 26' }];
    expect(() => validateBackupSession(session(entries))).not.toThrow();
    expect(parseSharedSession(session(entries)).formData.additionalEndorsements).toEqual(entries);
  });

  it.each([
    null, 'invalid', {}, [null], [{}], [{ id: 'second', endorsementBody: 12 }],
    [{ id: 'same' }, { id: 'same' }], Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
  ])('rejects malformed rows in links and backups: %j', (entries) => {
    expect(() => parseSharedSession(session(entries))).toThrow();
    expect(() => validateBackupSession(session(entries))).toThrow();
  });
});
