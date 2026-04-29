/**
 * Property tests for `src/lib/domainClassification.ts`.
 *
 * This module is the policy gate that decides which classification
 * levels a user can mark a document as. The "SECRET-default safety
 * bug" caught in PR #64 is exactly this class — a misconfigured
 * default could let an unclassified-only domain mark documents up to
 * SECRET. Tests here pin down the policy table for each domain
 * pattern and assert that `isClassificationAllowed` is consistent
 * with `getDomainClassificationRestriction.allowedLevels`.
 *
 * Caveat: the override-config path (`getClassificationConfigSync`)
 * isn't tested here — it reads a JSON file that's only present in
 * production builds. The default branch (no override) covers every
 * SECNAV / DoD policy decision the app makes for vanilla deployments.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  getDomainClassificationRestriction,
  isClassificationAllowed,
  getDomainRestrictionMessage,
  type ClassificationLevel,
} from '@/lib/domainClassification';

const ALL_LEVELS: ClassificationLevel[] = [
  'unclassified',
  'cui',
  'confidential',
  'secret',
  'top_secret',
  'top_secret_sci',
];

describe('getDomainClassificationRestriction — policy table', () => {
  it('non-government domain → UNCLASSIFIED only (the default safety net)', () => {
    expect(getDomainClassificationRestriction('example.com')).toEqual({
      maxLevel: 'unclassified',
      allowedLevels: ['unclassified'],
    });
  });

  it('empty / unknown domain → UNCLASSIFIED only', () => {
    expect(getDomainClassificationRestriction('')).toEqual({
      maxLevel: 'unclassified',
      allowedLevels: ['unclassified'],
    });
  });

  it('.mil → up to CONFIDENTIAL', () => {
    expect(getDomainClassificationRestriction('foo.mil').maxLevel).toBe('confidential');
    expect(getDomainClassificationRestriction('foo.mil').allowedLevels).toEqual([
      'unclassified',
      'cui',
      'confidential',
    ]);
  });

  it('.gov → up to CONFIDENTIAL', () => {
    expect(getDomainClassificationRestriction('foo.gov').maxLevel).toBe('confidential');
  });

  it('.smil.mil → up to SECRET', () => {
    expect(getDomainClassificationRestriction('app.smil.mil').maxLevel).toBe('secret');
  });

  it('.smil (bare) → up to SECRET', () => {
    expect(getDomainClassificationRestriction('app.smil').maxLevel).toBe('secret');
  });

  it('.ic.gov → up to TOP SECRET (with SCI)', () => {
    expect(getDomainClassificationRestriction('app.ic.gov').allowedLevels).toEqual(
      ALL_LEVELS
    );
  });
});

describe('isClassificationAllowed', () => {
  it('UNCLASSIFIED is always allowed (every policy includes it)', () => {
    fc.assert(
      fc.property(fc.domain(), (domain) => {
        expect(isClassificationAllowed('unclassified', domain)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('SECRET is NOT allowed on .com / .org / etc. (the bug class from PR #64)', () => {
    expect(isClassificationAllowed('secret', 'example.com')).toBe(false);
    expect(isClassificationAllowed('secret', 'docs.example.org')).toBe(false);
  });

  it('SECRET is NOT allowed on plain .mil (only .smil.mil)', () => {
    expect(isClassificationAllowed('secret', 'foo.mil')).toBe(false);
  });

  it('TOP SECRET is NOT allowed outside .ic.gov', () => {
    expect(isClassificationAllowed('top_secret', 'foo.mil')).toBe(false);
    expect(isClassificationAllowed('top_secret', 'app.smil.mil')).toBe(false);
    expect(isClassificationAllowed('top_secret', 'example.com')).toBe(false);
  });

  it('isClassificationAllowed is consistent with allowedLevels (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_LEVELS),
        fc.constantFrom(
          'example.com',
          'foo.mil',
          'foo.gov',
          'app.smil.mil',
          'app.smil',
          'app.ic.gov',
          'localhost',
          ''
        ),
        (level, domain) => {
          const allowed = isClassificationAllowed(level, domain);
          const restriction = getDomainClassificationRestriction(domain);
          expect(allowed).toBe(restriction.allowedLevels.includes(level));
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('getDomainRestrictionMessage', () => {
  it('returns a non-empty string for every domain', () => {
    fc.assert(
      fc.property(fc.domain(), (domain) => {
        const msg = getDomainRestrictionMessage(domain);
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('mentions "non-government" for plain .com / .org (so users see why they can only mark UNCLASSIFIED)', () => {
    expect(getDomainRestrictionMessage('example.com').toLowerCase()).toContain('non-government');
  });
});
