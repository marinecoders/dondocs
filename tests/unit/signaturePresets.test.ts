import { describe, it, expect } from 'vitest';
import { signaturePresets, standardSignaturePair } from '@/lib/signaturePresets';
import { signatureFieldName } from '@/services/pdf/signatureFieldCore';

describe('signaturePresets', () => {
  it('offers signer / acknowledgement / witness for both forms', () => {
    for (const form of ['navmc_10274', 'navmc_118_11'] as const) {
      const ids = signaturePresets(form).map((p) => p.id);
      expect(ids).toEqual(['signer', 'acknowledgement', 'witness']);
    }
  });

  it('labels the signer per form (Originator vs Counselor)', () => {
    const signer = (form: 'navmc_10274' | 'navmc_118_11') =>
      signaturePresets(form).find((p) => p.id === 'signer')!.label;
    expect(signer('navmc_10274')).toBe('Originator');
    expect(signer('navmc_118_11')).toBe('Counselor');
  });

  it('seeds a fresh typed block with an empty name', () => {
    for (const form of ['navmc_10274', 'navmc_118_11'] as const) {
      for (const preset of signaturePresets(form)) {
        const block = preset.make();
        expect(block.name).toBe('');
        expect(block.style).toBe('typed');
      }
    }
  });

  it('carries form-specific acknowledgement wording as an editable start', () => {
    const ack = (form: 'navmc_10274' | 'navmc_118_11') =>
      signaturePresets(form).find((p) => p.id === 'acknowledgement')!.make().statement;
    expect(ack('navmc_118_11')).toMatch(/counseled this date/i);
    expect(ack('navmc_10274')).toMatch(/acknowledge receipt/i);
    // The two forms must not share the same wording.
    expect(ack('navmc_118_11')).not.toBe(ack('navmc_10274'));
  });

  it('gives the witness preset the "Witnessed:" lead-in', () => {
    expect(signaturePresets('navmc_10274').find((p) => p.id === 'witness')!.make().statement).toBe(
      'Witnessed:'
    );
  });

  it('returns distinct block instances each call (no shared mutable state)', () => {
    const [a] = signaturePresets('navmc_10274');
    const first = a.make();
    first.name = 'R. L. SMITH';
    expect(a.make().name).toBe(''); // a later make() is unaffected
  });

  it('pre-fills names the app knows: signer ← profile, ack ← Marine; witness stays blank', () => {
    const names = { signer: 'R. L. SMITH', marine: 'J. M. DOE' };
    for (const form of ['navmc_10274', 'navmc_118_11'] as const) {
      const byId = Object.fromEntries(signaturePresets(form, names).map((p) => [p.id, p.make()]));
      expect(byId.signer.name).toBe('R. L. SMITH');
      expect(byId.acknowledgement.name).toBe('J. M. DOE');
      // Whoever witnessed is never guessable — no pre-fill even with names given.
      expect(byId.witness.name).toBe('');
    }
  });

  it('leaves names blank when the context has none (no profile, blank Marine ID)', () => {
    for (const preset of signaturePresets('navmc_118_11', {})) {
      expect(preset.make().name).toBe('');
    }
  });
});

describe('standardSignaturePair', () => {
  it('returns signer then acknowledgement, in signing order', () => {
    const [signer, ack] = standardSignaturePair('navmc_118_11', {
      signer: 'R. L. SMITH',
      marine: 'J. M. DOE',
    });
    expect(signer.statement).toBe(''); // counselor's block has no statement
    expect(signer.name).toBe('R. L. SMITH');
    expect(ack.statement).toMatch(/counseled this date/i);
    expect(ack.name).toBe('J. M. DOE');
    expect(standardSignaturePair('navmc_118_11')).toHaveLength(2);
  });

  it('uses the form-specific acknowledgement wording', () => {
    const [, aaAck] = standardSignaturePair('navmc_10274');
    expect(aaAck.statement).toMatch(/acknowledge receipt/i);
  });

  it('returns fresh instances each call', () => {
    const a = standardSignaturePair('navmc_10274');
    a[0].name = 'MUTATED';
    expect(standardSignaturePair('navmc_10274')[0].name).toBe('');
  });
});

describe('signatureFieldName', () => {
  it('derives a stable, sequenced field name from the typed name', () => {
    expect(signatureFieldName('R. L. Smith', 0)).toBe('R L Smith signature 0');
    expect(signatureFieldName('J.  A.   Doe', 1)).toBe('J A Doe signature 1');
  });

  it('falls back to a plain sequenced name when unnamed', () => {
    expect(signatureFieldName('', 2)).toBe('Signature 2');
    expect(signatureFieldName(undefined, 3)).toBe('Signature 3');
    expect(signatureFieldName('   ', 4)).toBe('Signature 4');
  });

  it('keeps sequential fields unique even for identical names', () => {
    expect(signatureFieldName('J. Doe', 0)).not.toBe(signatureFieldName('J. Doe', 1));
  });
});
