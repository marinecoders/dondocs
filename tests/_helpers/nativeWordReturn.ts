import { DOMParser } from '@xmldom/xmldom';
import { readWordArchive, xmlChildren } from '../../src/services/docx/import/archive';

const relationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const propertiesRelationships = new Map([
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties', 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'],
  ['http://purl.oclc.org/ooxml/officeDocument/relationships/extendedProperties', 'http://purl.oclc.org/ooxml/officeDocument/extendedProperties'],
]);

function parsePropertiesXml(bytes: Uint8Array, label: string): Element {
  const errors: string[] = [];
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw new Error(`The returned DOCX ${label} XML contains a forbidden declaration.`);
  const document = new DOMParser({
    errorHandler: { warning: error => errors.push(error), error: error => errors.push(error), fatalError: error => errors.push(error) },
  }).parseFromString(xml, 'application/xml');
  if (errors.length || !document.documentElement) throw new Error(`The returned DOCX ${label} XML is malformed.`);
  return document.documentElement;
}

/** Check package metadata alongside the operator's actual edit/save/reopen
 * observation. The metadata by itself does not establish where it was saved. */
export async function nativeWordReturnMetadata(bytes: Uint8Array) {
  const archive = await readWordArchive(bytes);
  const packageRelationships = archive.get('_rels/.rels');
  if (!packageRelationships) throw new Error('The returned DOCX has no package relationships.');
  const relationships = parsePropertiesXml(packageRelationships, 'package relationships');
  if (relationships.namespaceURI !== relationshipNamespace || relationships.localName !== 'Relationships') {
    throw new Error('The returned DOCX has invalid package relationships.');
  }
  const candidates = xmlChildren(relationships).filter(element => element.namespaceURI === relationshipNamespace
    && element.localName === 'Relationship' && propertiesRelationships.has(element.getAttribute('Type') ?? ''));
  const target = candidates[0]?.getAttribute('Target')?.trim();
  const mode = candidates[0]?.getAttribute('TargetMode');
  if (candidates.length !== 1 || !target || (mode && mode !== 'Internal')
    || target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target) || /[?#\\]/.test(target)) {
    throw new Error('The returned DOCX must declare one internal application properties part.');
  }
  const properties = archive.get(decodeURI(new URL(target, 'https://word.invalid/').pathname).slice(1));
  if (!properties) throw new Error('The returned DOCX has no application properties.');
  const document = parsePropertiesXml(properties, 'application properties');
  if (document.localName !== 'Properties' || document.namespaceURI !== propertiesRelationships.get(candidates[0].getAttribute('Type')!)) {
    throw new Error('The returned DOCX has invalid application properties.');
  }
  const fields = xmlChildren(document).filter(element => element.namespaceURI === document.namespaceURI);
  const applications = fields.filter(element => element.localName === 'Application');
  const application = applications[0]?.textContent?.trim();
  if (applications.length !== 1 || !application || xmlChildren(applications[0]).length
    || !/^Microsoft(?: Office| Macintosh)? Word(?: for Mac(?:intosh)?)?$/i.test(application)) {
    throw new Error('The returned DOCX application properties do not identify Microsoft Word.');
  }
  const versions = fields.filter(element => element.localName === 'AppVersion');
  if (versions.length > 1 || (versions[0] && xmlChildren(versions[0]).length)) {
    throw new Error('The returned DOCX contains ambiguous application versions.');
  }
  return { application, fileReportedVersion: versions[0]?.textContent?.trim() || null };
}
