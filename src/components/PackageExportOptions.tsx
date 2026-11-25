import { useEffect, useMemo, useState } from 'react';
import type { PackageDestination } from '@/lib/packageDestinations';
import type { PackageRequirementFinding } from '@/lib/packageRequirements';
import { indexDeliveryDocuments } from '@/lib/packageDeliveryDocuments';
import { PackageDeliveryFindings } from './PackageDeliveryFindings';
import type { PackageRevision } from '@/lib/actionPackages';
import { Button } from './ui/button';

export function PackageExportOptions({ revision, format, disabled, pdfDisabled, active, canSign, onNavigate, onFormat, onPrepare, onOpenDocument }: {
  revision: PackageRevision;
  active: boolean;
  canSign: boolean;
  onNavigate(target: PackageDestination): void;
  format: 'pdf' | 'draft' | 'editable';
  disabled: boolean;
  pdfDisabled: boolean;
  onFormat(format: 'pdf' | 'draft' | 'editable'): void;
  onPrepare(): void;
  onOpenDocument(id: string): void;
}) {
  const inspect = active && format === 'pdf';
  const [inspection, setInspection] = useState<{ revision: PackageRevision; findings: PackageRequirementFinding[]; error?: string }>();
  useEffect(() => {
    if (!inspect) return;
    const controller = new AbortController();
    void (async () => {
      const { assertDeliveryRequirements, PackageDeliveryBlocked } = await import('@/lib/packageRequirements');
      controller.signal.throwIfAborted();
      try {
        await assertDeliveryRequirements(revision, undefined, controller.signal);
        if (!controller.signal.aborted) setInspection({ revision, findings: [] });
      } catch (error) {
        if (error instanceof PackageDeliveryBlocked && !controller.signal.aborted) {
          setInspection({ revision, findings: error.findings });
        } else throw error;
      }
    })().catch(() => {
      if (!controller.signal.aborted) setInspection({ revision, findings: [], error: 'Delivery checks could not be loaded. Prepare PDF to run the checks again.' });
    });
    return () => controller.abort();
  }, [inspect, revision]);
  const checked = inspect && inspection?.revision === revision ? inspection : undefined;
  const documents = useMemo(() => indexDeliveryDocuments(revision), [revision]);
  const byDocument = new Map<string, PackageRequirementFinding[]>();
  const remaining: PackageRequirementFinding[] = [];
  for (const item of checked?.findings ?? []) {
    if (!item.memberId || !documents.members.has(item.memberId)) { remaining.push(item); continue; }
    const group = byDocument.get(item.memberId);
    if (group) group.push(item);
    else byDocument.set(item.memberId, [item]);
  }
  const reviewItems = (items: PackageRequirementFinding[]) => <PackageDeliveryFindings documents={documents} revision={revision} findings={items} onNavigate={onNavigate} disabled={disabled} canSign={canSign} />;
  return <div className="space-y-7">
    <div role="group" aria-label="File format" className="flex flex-wrap gap-2">
      {(['pdf', 'draft', 'editable'] as const).map(value => <Button key={value} variant={value === format ? 'secondary' : 'outline'} aria-pressed={value === format} disabled={disabled} onClick={() => onFormat(value)}>{value === 'pdf' ? 'PDF' : value === 'draft' ? 'Draft PDF' : 'Editable package'}</Button>)}
    </div>
    <section><div className="mb-3 flex items-center justify-between gap-4"><h3 className="text-sm font-medium">Included documents</h3><span className="text-xs text-muted-foreground">{format === 'draft' ? 'Draft marked on every page' : format === 'pdf' ? 'Combined PDF · Unsigned' : 'Open in DonDocs'}</span></div>
      {inspect && !checked && <p role="status" className="text-xs text-muted-foreground">Checking delivery requirements…</p>}
      {checked?.error && <p role="alert" className="text-sm">{checked.error}</p>}
      <ol className="divide-y">{revision.members.map((member, index) => {
        const items = byDocument.get(member.id) ?? [];
        const signatures = new Set(items.flatMap(item => item.signatureFields ?? [])).size;
        const otherIssues = new Set(items.flatMap(item => (item.documentIssues ?? [item.message])
          .map(message => JSON.stringify([item.label, message])))).size;
        const summary = [signatures && `${signatures} signature${signatures === 1 ? '' : 's'} needed`,
          otherIssues && `${otherIssues} item${otherIssues === 1 ? '' : 's'} to resolve`].filter(Boolean).join(' · ');
        return <li key={member.id} className="py-3">
          <div className="flex items-center gap-4"><span className="text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 break-words text-sm">{member.label}</span><Button variant="link" size="sm" disabled={disabled} onClick={() => onOpenDocument(member.id)}>Open</Button></div>
          {!!items.length && <details className="ml-5 text-sm"><summary className="cursor-pointer">{summary}</summary>{reviewItems(items)}</details>}
        </li>;
      })}</ol>
      {!!remaining.length && <section className="mt-3 border-t pt-3" aria-label="Package requirements"><h4 className="text-sm font-medium">Package requirements</h4>{reviewItems(remaining)}</section>}
      {!revision.members.length && format === 'editable' && <p className="text-sm text-muted-foreground">No documents have been generated yet. The editable package preserves this saved draft.</p>}
      {format === 'editable' && <>
        {revision.outputs.map(output => <p key={output.id} className="border-t py-3 text-sm">{output.asset.name}<span className="ml-3 text-xs text-muted-foreground">Retained PDF</span></p>)}
        <p className="mt-3 text-xs text-muted-foreground">Includes full saved editable data, including inactive answers and embedded files. Earlier package versions are excluded.</p>
      </>}
    </section>
    <Button disabled={disabled || format !== 'editable' && (pdfDisabled || !revision.members.length)} onClick={onPrepare}>{format === 'draft' ? 'Prepare draft PDF' : format === 'pdf' ? 'Prepare PDF' : 'Prepare editable package'}</Button>
  </div>;
}
