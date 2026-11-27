import { expect, it } from 'vitest';
import { signatureOrderIssue } from '@/services/forms/signatureOrder';
import type { OfficialInspection } from '@/services/forms/signingBridge';

const slot = (name: string) => ({ name, label: name, signed: false, locked: false, trusted: null, lockAction: '', lockFields: [] as string[] });
it('protects required unsigned slots for inclusive, exclusive, final and returned locks', () => {
  const pdf: OfficialInspection = { formId: 'test', edition: '1', sha256: '', fields: [slot('authority'), slot('unit.marine'), slot('optional')] };
  const required = new Map([['unit.marine', 'Marine']]);
  const field = pdf.fields[0];
  field.lockAction = 'Include'; field.lockFields = ['unit'];
  expect(signatureOrderIssue(pdf, field.name, false, required)).toContain('Marine');
  field.lockAction = 'Exclude';
  expect(signatureOrderIssue(pdf, field.name, false, required)).toBeUndefined();
  expect(signatureOrderIssue(pdf, field.name, true, required)).toContain('Marine');
  expect(signatureOrderIssue(pdf, field.name, false, required, { ...pdf, fields: [{...pdf.fields[1], locked:true}] })).toContain('Marine');
  field.lockAction = 'All'; pdf.fields[1].signed = true; pdf.fields[1].trusted = true;
  expect(signatureOrderIssue(pdf, field.name, false, required)).toBeUndefined();
});
it('protects item 2 even when starting outside a package', () => {
  const first = slot('2 ACC ELECTION AND RIGHTS SIGNATURE'), next = slot('3 RIGHTS ATTEST SIGNATURE');
  const pdf = {formId:'navmc10132',edition:'2023-08',sha256:'',fields:[first,next]};
  expect(signatureOrderIssue(pdf, next.name, false)).toContain(first.name);
  expect(signatureOrderIssue(pdf, first.name, false)).toBeUndefined();
});
