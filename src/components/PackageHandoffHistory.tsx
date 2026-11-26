import { useEffect, useState } from 'react';
import { comparePackageHandoffs, handoffPurpose, listPackageHandoffs, type PackageHandoff } from '@/lib/packageHandoffHistory';

export function PackageHandoffHistory({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="mb-3 text-sm" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-muted-foreground">Prepared handoffs</summary>
    {open && <History key={packageId} packageId={packageId} />}
  </details>;
}

function History({ packageId }: { packageId: string }) {
  const [records, setRecords] = useState<PackageHandoff[]>(), [error, setError] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [selectedId, setSelectedId] = useState(''), [previousId, setPreviousId] = useState('');
  useEffect(() => {
    let current = true;
    void listPackageHandoffs(packageId).then(values => {
      if (!current) return;
      setRecords(values); setSelectedId(values[0]?.id ?? ''); setPreviousId(values[1]?.id ?? '');
    }).catch(() => { if (current) setError('Prepared handoff history could not be read.'); });
    return () => { current = false; };
  }, [packageId]);
  if (error) return <p role="alert">{error}</p>;
  if (!records) return <p role="status">Loading handoffs…</p>;
  if (!records.length) return <p className="py-2">No file deliveries prepared on this device.</p>;
  const selected = records.find(item => item.id === selectedId)!;
  const previous = records.find(item => item.id === previousId);
  const options = records.map(item => <option key={item.id} value={item.id}>{item.label} · {new Date(item.createdAt).toLocaleString()} · {item.id.slice(-8)}</option>);
  return <div className="space-y-2 py-2">
    <label className="block">Prepared delivery <select value={selectedId} onChange={event => {
      const id = event.target.value; setSelectedId(id);
      if (previousId === id) setPreviousId(selectedId);
    }}>{options}</select></label>
    <p>{handoffPurpose[selected.purpose]} · Revision {selected.revisionId.slice(-8)} · {selected.members.length} documents</p>
    {records.length > 1 && <label className="block">Compare with <select value={previousId} onChange={event => setPreviousId(event.target.value)}>
      <option value="">No comparison</option>{options.filter(option => option.key !== selectedId)}
    </select></label>}
    {selected.output && <p className="break-words">{selected.output.name}{previous?.output && (previous.output.sha256 === selected.output.sha256 ? ' · Same output bytes' : ' · Different output bytes')}</p>}
    <ol className="list-inside list-decimal">{(previous ? comparePackageHandoffs(previous, selected) : selected.members.map(item => ({ ...item, status: '' }))).map(item =>
      <li key={item.id}>{item.label}{item.status && <span className="ml-2 text-muted-foreground">{item.status}</span>}</li>)}</ol>
    <details onToggle={event => setShowFiles(event.currentTarget.open)}><summary className="cursor-pointer">File checksums</summary>{showFiles && <ul>
      {selected.output && <li className="break-all">{selected.output.name} · {selected.output.sha256}</li>}
      {selected.members.filter(item => item.files.length).map(item =>
      <li key={item.id}>{item.label}<ul>{item.files.map((file, index) => <li className="break-all" key={index}>{file.name} · {file.sha256}</li>)}</ul></li>)}</ul>}</details>
    <p className="text-xs text-muted-foreground">Latest 20 file deliveries prepared on this device.</p>
  </div>;
}
