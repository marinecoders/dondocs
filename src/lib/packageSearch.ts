import { packageScanIsCurrent } from './packageScanModel';
import { actionPackageSchema, getPackageRevision, type ActionPackage, type PackageAsset } from './actionPackages';
import { readPackageAsset, readPackageMemberDraft } from './actionPackageAssets';
import { inspectPackageAttachment } from './packageAttachmentCapabilities';
import { inspectPackagePdf } from './packagePdfEvidence';
import { sessionSearchFields, matchesSearch, findSearchMatch } from './workspaceSearch';
import { portableResourceDigest } from './portableResources';
import type { PackageDestination } from './packageDestinations';

export interface PackageSearchMatch { id: string; label: string; context: string; snippet: string; text: string; destination: PackageDestination }
export interface PackageSearchReport { packageId: string; revisionId: string; query: string; matches: PackageSearchMatch[]; limited: boolean; notices: string[] }
export interface PackageSearchOptions { signal?: AbortSignal; readAsset?: (asset: PackageAsset) => Promise<ArrayBuffer> }
class SearchLimit extends Error {}
const MAX_TEXT = 2_000_000, MAX_FIELDS = 5000, MAX_MATCHES = 100;

/** The caller supplies one captured revision or a privately prepared delivery projection; inventory never visits other history. */
export async function searchCapturedPackage(input: ActionPackage, revisionId: string, query: string, options: PackageSearchOptions = {}): Promise<PackageSearchReport> {
  const record = actionPackageSchema.parse(structuredClone(input)), revision = getPackageRevision(record, revisionId), term = query.trim();
  if (term.length > 200) throw new Error('Search with 200 characters or fewer.');
  const report: PackageSearchReport = { packageId: record.id, revisionId, query: term, matches: [], limited: false, notices: [] };
  if (!term) return report;
  const rawRead = options.readAsset ?? readPackageAsset, signal = options.signal ?? new AbortController().signal;
  const read = async (asset: PackageAsset) => {
    signal.throwIfAborted(); const bytes = await rawRead(asset);
    if (bytes.byteLength !== asset.size || await portableResourceDigest(bytes) !== asset.sha256) throw new Error(`The captured file does not match its saved digest: ${asset.name}.`);
    signal.throwIfAborted(); return bytes;
  };
  let characters = 0, fields = 0, ordinal = 0;
  const add = (label: string, context: string, text: string, destination: PackageDestination) => {
    signal.throwIfAborted(); characters += text.length; fields++;
    if (characters > MAX_TEXT || fields > MAX_FIELDS) { report.limited = true; return; }
    if (!matchesSearch(text, term)) return;
    if (report.matches.length >= MAX_MATCHES) { report.limited = true; return; }
    const match = findSearchMatch([{ text, sectionId: 'captured', label }], term)!;
    report.matches.push({ id: `match-${++ordinal}`, label, context, snippet: match.snippet, text: text.slice(0, 20_000), destination: { ...destination, revisionId } });
  };
  for (const fact of revision.information?.facts ?? []) {
    const person = revision.information?.participants.find(person => person.id === fact.participantId);
    const context = person ? `Confirmed value · ${person.label} (${person.role})` : 'Confirmed package value';
    add(fact.label, context, `${person ? `${person.label} (${person.role}) · ` : ''}${fact.label}: ${String(fact.value)}`, { section: 'overview', factId: fact.id });
  }
  for (const requirement of revision.requirements?.items ?? []) add(requirement.label, 'Saved requirement', requirement.label, { section: 'overview', panel: 'requirements', requirementId: requirement.id });
  for (const member of revision.members) {
    signal.throwIfAborted(); if (report.limited) break;
    const destination: PackageDestination = { section: 'documents', memberId: member.id };
    add(member.label, 'Captured member name', member.label, destination);
    try {
      if (member.kind === 'native') {
        const { reviewed } = await readPackageMemberDraft(member, read);
        for (const field of sessionSearchFields(reviewed.session)) { add(member.label, field.label, field.text, destination); if (report.limited) break; }
      } else if (member.kind === 'attachment') {
        const inspection = await inspectPackageAttachment({ name: member.original.name, type: member.original.type, data: await read(member.original) }, signal);
        if (inspection.text) add(member.label, 'Retained supporting-file text', inspection.text, destination);
      } else {
        let page = 0;
        await inspectPackagePdf(await read(member.original), signal, text => { page++; add(member.label, `Captured PDF page ${page}`, text, destination); if (report.limited) throw new SearchLimit(); });
      }
    } catch (cause) {
      signal.throwIfAborted(); if (cause instanceof SearchLimit) break; report.notices.push(`${member.label}: ${cause instanceof Error ? cause.message : 'Captured text could not be inspected.'}`);
    }
    // Yield between captured members so cancellation and input can be processed.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  for (const scan of revision.scans?.items ?? []) {
    if (report.limited) break;
    if (!packageScanIsCurrent(scan, revision)) { report.notices.push(`${scan.memberLabel}: saved recognized text belongs to an earlier source and is excluded from current-member results.`); continue; }
    try { await read(scan.source); } catch (cause) { signal.throwIfAborted(); report.notices.push(`${scan.memberLabel}: saved recognized text could not be verified: ${cause instanceof Error ? cause.message : "Source unavailable"}`); continue; }
    for (const page of scan.pages) { add(scan.memberLabel, `Saved corrected source page ${page.page}`, page.text, { section: 'documents', memberId: scan.memberId }); if (report.limited) break; }
  }
  for (const output of revision.outputs) {
    if (report.limited) break;
    try {
      let page = 0;
      await inspectPackagePdf(await read(output.asset), signal, text => { page++; add(output.asset.name, `Retained PDF page ${page}`, text, { section: 'delivery', outputId: output.id }); if (report.limited) throw new SearchLimit(); });
    } catch (cause) { signal.throwIfAborted(); if (cause instanceof SearchLimit) break; report.notices.push(`${output.asset.name}: ${cause instanceof Error ? cause.message : 'Retained PDF text could not be inspected.'}`); }
  }
  if (report.limited) report.notices.push('This search reached its captured-text or result limit. Refine the query to inspect more specific content.');
  report.notices.push('Results describe this exact captured revision. Images without saved recognized text have no searchable text layer.');
  return report;
}
