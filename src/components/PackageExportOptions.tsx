import type { PackageRevision } from '@/lib/actionPackages';
import { Button } from './ui/button';

export function PackageExportOptions({ revision, format, disabled, pdfDisabled, onFormat, onPrepare, onOpenDocument }: {
  revision: PackageRevision;
  format: 'pdf' | 'editable';
  disabled: boolean;
  pdfDisabled: boolean;
  onFormat(format: 'pdf' | 'editable'): void;
  onPrepare(): void;
  onOpenDocument(id: string): void;
}) {
  return <div className="space-y-7">
    <div role="group" aria-label="File format" className="flex flex-wrap gap-2">
      {(['pdf', 'editable'] as const).map(value => <Button key={value} variant={value === format ? 'secondary' : 'outline'} aria-pressed={value === format} disabled={disabled} onClick={() => onFormat(value)}>{value === 'pdf' ? 'PDF' : 'Editable package'}</Button>)}
    </div>
    <section><div className="mb-3 flex items-center justify-between gap-4"><h3 className="text-sm font-medium">Included documents</h3><span className="text-xs text-muted-foreground">{format === 'pdf' ? 'Combined PDF · Unsigned' : 'Open in DonDocs'}</span></div>
      <ol className="divide-y">{revision.members.map((member, index) => <li key={member.id} className="flex items-center gap-4 py-4"><span className="text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 break-words text-sm">{member.label}</span><Button variant="link" size="sm" onClick={() => onOpenDocument(member.id)}>Open</Button></li>)}</ol>
      {!revision.members.length && format === 'editable' && <p className="text-sm text-muted-foreground">No documents have been generated yet. The editable package preserves this saved draft.</p>}
      {format === 'editable' && <>
        {revision.outputs.map(output => <p key={output.id} className="border-t py-3 text-sm">{output.asset.name}<span className="ml-3 text-xs text-muted-foreground">Retained PDF</span></p>)}
        <p className="mt-3 text-xs text-muted-foreground">Includes full saved editable data, including inactive answers and embedded files. Earlier package versions are excluded.</p>
      </>}
    </section>
    <Button disabled={disabled || format === 'pdf' && (pdfDisabled || !revision.members.length)} onClick={onPrepare}>{format === 'pdf' ? 'Prepare PDF' : 'Prepare editable package'}</Button>
  </div>;
}
