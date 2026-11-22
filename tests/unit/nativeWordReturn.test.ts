// @vitest-environment node
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { nativeWordReturnMetadata } from '../_helpers/nativeWordReturn';

const propertiesNs = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';
const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const relation = '<Relationship Id="app" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>';

async function fixture(application?: string, options: { file?: string; relation?: string; properties?: string; duplicate?: string } = {}) {
  const archive = new JSZip();
  archive.file('_rels/.rels', `<Relationships xmlns="${relationshipNs}">${options.relation ?? relation}</Relationships>`);
  if (application !== undefined) archive.file(options.file ?? 'docProps/app.xml',
    options.properties ?? `<Properties xmlns="${propertiesNs}"><Application>${application}</Application><AppVersion>16.0000</AppVersion></Properties>`);
  if (options.duplicate) archive.file('docProps/app.xml',
    `<Properties xmlns="${propertiesNs}"><Application>${options.duplicate}</Application></Properties>`);
  return archive.generateAsync({ type: 'uint8array' });
}

it.each(['Microsoft Office Word', 'Microsoft Macintosh Word', 'Microsoft Word for Mac'])(
  'records the application properties of a return saved by %s', async application => {
    await expect(nativeWordReturnMetadata(await fixture(application))).resolves.toEqual({
      application, fileReportedVersion: '16.0000',
    });
  },
);

it('refuses a renderer-substituted or missing application property in native evidence', async () => {
  await expect(nativeWordReturnMetadata(await fixture('LibreOffice/26.8.0.0'))).rejects.toThrow('do not identify Microsoft Word');
  await expect(nativeWordReturnMetadata(await fixture())).rejects.toThrow('no application properties');
});

it('uses the registered properties part, including its Strict OOXML spelling', async () => {
  const bytes = await fixture('Microsoft Word', { file: 'metadata/properties.xml',
    relation: '<Relationship Id="app" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/extendedProperties" Target="/metadata/properties.xml"/>',
    properties: '<p:Properties xmlns:p="http://purl.oclc.org/ooxml/officeDocument/extendedProperties"><p:Application>Microsoft Word</p:Application></p:Properties>',
    duplicate: 'LibreOffice' });
  await expect(nativeWordReturnMetadata(bytes)).resolves.toEqual({ application: 'Microsoft Word', fileReportedVersion: null });
  await expect(nativeWordReturnMetadata(await fixture('LibreOffice', {
    file: 'metadata/properties.xml', relation: relation.replace('docProps/app.xml', 'metadata/properties.xml'), duplicate: 'Microsoft Word',
  }))).rejects.toThrow('do not identify Microsoft Word');
});

it('refuses malformed, unregistered, external, or ambiguous properties', async () => {
  await expect(nativeWordReturnMetadata(await fixture('Microsoft Word', { relation: '' }))).rejects.toThrow('one internal');
  await expect(nativeWordReturnMetadata(await fixture('Microsoft Word', { relation: relation + relation }))).rejects.toThrow('one internal');
  await expect(nativeWordReturnMetadata(await fixture('Microsoft Word', { relation: relation.replace('/>', ' TargetMode="External"/>') }))).rejects.toThrow('one internal');
  await expect(nativeWordReturnMetadata(await fixture('Microsoft Word', {
    properties: `<Properties xmlns="${propertiesNs}"><Wrapper><Application>Microsoft Word</Application></Wrapper></Properties>`,
  }))).rejects.toThrow('do not identify Microsoft Word');
  await expect(nativeWordReturnMetadata(await fixture('Microsoft Word', {
    properties: `<Properties xmlns="${propertiesNs}"><Application>Microsoft Word</Properties>`,
  }))).rejects.toThrow('XML is malformed');
});
