import type { PackageTemplateV2 } from '@/lib/packageTemplateSchema';
import { fixtureInstance, fixturePage } from './formFixture';
import { uint8ArrayToBase64 } from '@/lib/encoding';

export function maintenanceFixture(): PackageTemplateV2 {
  const draft = { kind: 'dondocs-draft', version: 2, documentKind: 'correspondence', documentMode: 'compliant', documentCategory: 'correspondence', docType: 'standard_letter', formType: 'navmc_10274', timestamp: 0,
    formData: { docType: 'standard_letter', from: '', to: '', subject: '', date: '', ssic: '', sigFirst: '', sigMiddle: '', sigLast: '', signatureType: 'none' }, paragraphs: [], references: [], enclosures: [], copyTos: [], distributions: [], endItems: [], publicationTables: {} };
  return { kind: 'dondocs-package-template', version: 2, id: 'synthetic_maintainer', name: 'Synthetic maintained action', createdAt: 0,
    program: { revision: '2', questions: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }], participantGroups: [], requirements: [] },
    members: [{ key: 'main', label: 'Synthetic letter', role: 'basic-letter', required: true, kind: 'native', draft, pages: {}, links: [{ questionId: 'subject', target: { kind: 'correspondence', docType: 'standard_letter', field: 'subject' }, format: 'uppercase' }] }] };
}
export async function configuredMaintenanceFixture(): Promise<PackageTemplateV2> {
  const template = maintenanceFixture(), instance = fixtureInstance(), page = await fixturePage();
  instance.answers = {}; instance.definition.pages[0].sha256 = page.sha256;
  const member = template.members[0]; if (member.kind !== 'native') throw new Error('Native fixture expected');
  member.draft = { ...member.draft, documentKind: 'configured-form', documentCategory: 'forms', formType: 'fixture', genericForm: instance };
  member.pages = { 'page1.pdf': { name: 'page1.pdf', type: 'application/pdf', data: uint8ArrayToBase64(page.bytes) } }; member.links = [];
  return template;
}
