import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import type { ActionPackage } from '@/lib/actionPackages';
import { administrativeRequestSchema, prepareAdministrativeRequest, createPreparedAdministrativeRequest,
  type AdministrativeRequestInput, type PreparedAdministrativeRequest } from '@/lib/administrativeRequest';
import { getExportDeploymentPolicy } from '@/config/classification';

interface Props {
  disabled: boolean;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  onCreate(record: ActionPackage): void;
  signal(): AbortSignal | undefined;
  isCurrent(): boolean;
  onDirtyChange?(dirty: boolean): void;
}
const empty = (): AdministrativeRequestInput => ({ requester: '', organization: '', recipient: '', subject: '', requestDate: '', ssic: '', details: '', signatureName: '' });
const labels: Record<keyof AdministrativeRequestInput, string> = {
  requester: 'Requester', organization: 'Organization', recipient: 'Recipient', subject: 'Request subject', requestDate: 'Request date',
  ssic: 'SSIC', signatureName: 'Printed signature name', details: 'Requested action and justification',
};

/** A maintained starter creates native members; their existing editors own all later drafting. */
export function AdministrativeRequestStarter({ disabled, busy, run, onCreate, signal, isCurrent, onDirtyChange }: Props) {
  const [open, setOpen] = useState(false), [values, setValues] = useState(empty);
  const [prepared, setPrepared] = useState<PreparedAdministrativeRequest | null>(null), [approved, setApproved] = useState(false);
  const alive = useRef(true), generation = useRef(0);
  const firstInput = useRef<HTMLInputElement>(null), startButton = useRef<HTMLButtonElement>(null), returnFocus = useRef(false);
  const dirty = Object.values(values).some(value => value.length > 0);
  useEffect(() => { if (open) firstInput.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open && returnFocus.current && !busy && !disabled) { returnFocus.current = false; startButton.current?.focus(); }
  }, [open, busy, disabled]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; onDirtyChange?.(false); }; }, [onDirtyChange]);
  function change(key: keyof AdministrativeRequestInput, value: string) {
    generation.current++; setValues(before => ({ ...before, [key]: value })); setPrepared(null); setApproved(false);
  }
  function reset() { generation.current++; returnFocus.current = true; setValues(empty()); setPrepared(null); setApproved(false); setOpen(false); }
  function current(version: number) { return alive.current && generation.current === version && isCurrent() && !signal()?.aborted; }
  const findings = prepared ? [...new Set(prepared.reviews.flatMap(review => [
    ...review.notices, ...review.privacy.findings.map(finding => `${finding.type}: ${finding.field}: ${finding.value}`),
  ]))] : [];
  return <section aria-label="Administrative request starter" className="min-w-0 space-y-3 rounded border p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-medium">Administrative request</h3>
        <p className="mt-1 text-sm text-muted-foreground">Start a forwarding letter and a DonDocs request details worksheet. Enter shared details once.</p>
      </div>
      {!open && <Button ref={startButton} className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" disabled={disabled || busy} onClick={() => setOpen(true)}>Start an administrative request</Button>}
    </div>
    {open && <fieldset disabled={disabled || busy} className="min-w-0 space-y-3">
      <legend className="sr-only">New administrative request</legend>
      <p className="text-xs text-muted-foreground">New request · not saved until you create the package.</p>
      <p className="text-sm text-muted-foreground">General request starter. The worksheet is not an official form. Choose the required evidence, routing and signing authority for your action.</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {(Object.keys(labels) as Array<keyof AdministrativeRequestInput>).map(key => <label key={key} className={`min-w-0 text-sm ${key === 'details' ? 'sm:col-span-2' : ''}`}>
          {labels[key]}
          {key === 'details' ? <textarea className="mt-1 min-h-28 w-full rounded border bg-background p-2" value={values[key]} maxLength={900} required autoComplete="off"
            onChange={event => change(key, event.target.value)} />
            : <input ref={key === 'requester' ? firstInput : undefined} className="mt-1 w-full min-w-0 rounded border bg-background p-2" value={values[key]} required autoComplete="off"
              type={key === 'requestDate' ? 'date' : 'text'} inputMode={key === 'ssic' ? 'numeric' : undefined}
              min={key === 'requestDate' ? '2000-01-01' : undefined} max={key === 'requestDate' ? '2099-12-31' : undefined}
              maxLength={key === 'ssic' ? 4 : key === 'subject' ? 100 : 120} onChange={event => change(key, event.target.value)} />}
          {key === 'signatureName' && <span className="mt-1 block text-xs text-muted-foreground">Separate printed signature text, such as initials and surname. This adds no signature or approval.</span>}
        </label>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={!administrativeRequestSchema.safeParse(values).success} onClick={() => void run(async () => {
          const version = generation.current, policy = await getExportDeploymentPolicy();
          if (!current(version)) return;
          const capture = await prepareAdministrativeRequest(values, policy, signal());
          if (current(version)) { setPrepared(capture); setApproved(false); }
        })}>Review request starter</Button>
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" variant="outline" onClick={reset}>Cancel request starter</Button>
      </div>
      {prepared && <div className="space-y-3 rounded border p-3 text-sm" aria-label="Review request starter">
        <h4 className="font-medium">{prepared.packageName}</h4>
        <p>Creates two editable documents with linked request details. The letter uses the subject in uppercase; the worksheet keeps the entered text. Its body points to the worksheet.</p>
        <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
          {(Object.keys(labels) as Array<keyof AdministrativeRequestInput>).map(key => <div key={key} className={`min-w-0 ${key === 'details' ? 'sm:col-span-2' : ''}`}>
            <dt className="font-medium">{labels[key]}</dt><dd className="whitespace-pre-wrap break-words">{prepared.values[key]}</dd>
          </div>)}
        </dl>
        {findings.length > 0 && <details><summary className="cursor-pointer">Privacy and marking findings</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{findings.map(finding => <li key={finding} className="whitespace-pre-wrap break-words">{finding}</li>)}</ul>
        </details>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I reviewed these request details, the separate signature name and any privacy or marking findings.</label>
        <Button className="h-auto min-h-9 max-w-full whitespace-normal" disabled={!approved} onClick={() => void run(async () => {
          const version = generation.current, policy = await getExportDeploymentPolicy();
          if (!current(version)) return;
          const record = await createPreparedAdministrativeRequest(prepared, policy, approved, signal(), () => current(version));
          if (current(version)) { reset(); onCreate(record); }
        })}>Create reviewed request package</Button>
      </div>}
    </fieldset>}
  </section>;
}
