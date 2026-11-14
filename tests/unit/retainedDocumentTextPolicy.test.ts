import { expect, it } from 'vitest';
import { createBlankSession } from '@/stores/documentStore';
import { assertRetainedDocumentTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { fixtureInstance } from '../_helpers/formFixture';

const restricted = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
it.each([
  ['unknown image field', { image: '(S) Retained image description' }],
  ['unknown timestamp field', { timestamp: '(TS) Retained legacy metadata' }],
  ['unknown nested value', { legacy: { image: '(S) Retained nested field' } }],
  ['unknown data-URI-like text', { legacy: 'data:image/not-an-asset\r\n(S) Retained text' }],
  ['signature filename', { signatureImage: { name: '(TS) signature.png', size: 1, data: 'AA==' } }],
  ['inactive letter field', { jointJuniorFrom: '(CUI) Retained address' }],
] as const)('rejects a marking in %s even when a report/output projection omits it', (_label, fields) => {
  const source = createBlankSession();Object.assign(source.formData, fields);
  expect(() => assertRetainedDocumentTextPolicy(source, restricted)).toThrow(/outside this deployment/);
});

it('checks unselected configured-form definition choices that travel with the filled form', () => {
  const source = createBlankSession(), form = fixtureInstance();
  form.definition.fields.decision.options![1].label = '(S) Retained unselected choice';
  source.documentCategory = 'forms';source.formType = form.definition.formId;source.genericForm = form;
  expect(() => assertRetainedDocumentTextPolicy(source, restricted)).toThrow(/outside this deployment/);
});

it('preserves binary exclusions and does not infer markings from ordinary prose', () => {
  const source = createBlankSession();
  source.formData.signatureImage = { name: 'signature.png', size: 1, data: 'SECRET' };
  source.paragraphs[0].text = 'Secret Service coordinates this fictional example.';
  expect(() => assertRetainedDocumentTextPolicy(source, restricted)).not.toThrow();
});

it('uses the issued allowed-level set rather than a permissive maximum', () => {
  const source = createBlankSession();source.paragraphs[0].text = '(S) Fictional marked text';
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', runtime: { status: 'absent' },
    environment: { maxLevel: 'top_secret', allowedLevels: ['unclassified', 'top_secret'] } });
  expect(() => assertRetainedDocumentTextPolicy(source, policy)).toThrow(/outside this deployment/);
  expect(() => assertRetainedDocumentTextPolicy(source, { status: 'error', message: 'Unavailable policy' })).toThrow('Unavailable policy');
});
