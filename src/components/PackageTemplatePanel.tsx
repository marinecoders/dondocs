import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionPackage } from '@/lib/actionPackages';
import { getPackageRevision } from '@/lib/actionPackages';
import { capturePackageTemplate, deletePackageTemplate, exportPackageTemplate, importPackageTemplate,
  instantiatePackageTemplate, listPackageTemplates, MAX_PACKAGE_TEMPLATE_BYTES, MAX_TEMPLATE_ACTION_BYTES, packageTemplatePlaceholders, packageTemplateFileSlots,
  renamePackageTemplate, type PackageTemplate, type TemplateAttachment } from '@/lib/packageTemplateLibrary';
import { documentTextFields, type DocumentFieldSource } from '@/lib/documentFields';
import { parseDraftFile } from '@/lib/draftFile';
import { reviewPackageNative, reviewPackageOriginal, reviewPackageText } from '@/lib/actionPackageDisclosure';
import { assertRetainedDocumentTextPolicy } from '@/lib/retainedDocumentTextPolicy';
import { getExportDeploymentPolicy, getExportDeploymentPolicySync } from '@/config/classification';
import { base64ToUint8Array, triggerDownload } from '@/lib/encoding';
import type { PolicyResolution } from '@/lib/exportDeploymentPolicy';
import type { ExportReview } from '@/lib/preparedExport';
import { packageTemplateProgramText } from '@/lib/packageTemplateSchema';

interface Props {
  record?: ActionPackage;
  revisionId?: string;
  busy: boolean;
  run(action: () => Promise<void>): Promise<void>;
  signal(): AbortSignal | undefined;
  isCurrent(): boolean;
  onCreate(record: ActionPackage): void;
}
async function reviewTemplate(template: PackageTemplate, policy: PolicyResolution): Promise<ExportReview[]> {
  const reviews = [reviewPackageText([template.name, ...template.members.flatMap(member => [member.label, ...(member.kind === 'native' ? [...Object.values(member.pages).map(page => page.name), ...(member.requiredFiles ?? []).map(file => file.label)] : [])])].join('\n'), 'Package template labels', policy)];
  if (template.version === 2) reviews.push(reviewPackageText(packageTemplateProgramText(template), 'Template questions, conditions and requirements', policy));
  const reviewedPages = new Set<string>();
  for (const member of template.members) if (member.kind === 'native') {
    const { session } = parseDraftFile(member.draft, false, true);
    reviews.push(reviewPackageNative(session, member.label, policy, member.draft as unknown as DocumentFieldSource));
    if (template.version === 2) for (const page of Object.values(member.pages)) {
      if (reviewedPages.has(page.data)) continue;
      reviewedPages.add(page.data);
      reviews.push(await reviewPackageOriginal(new Uint8Array(base64ToUint8Array(page.data)).buffer, `Template background: ${page.name}`, policy));
    }
  }
  return reviews;
}
function samePolicy(before: PolicyResolution, after: PolicyResolution): boolean {
  return before.status === 'ready' && after.status === 'ready' && JSON.stringify(before.policy) === JSON.stringify(after.policy);
}
function StarterContents({ template }: { template: PackageTemplate }) {
  return <details className="rounded border p-2 text-sm">
    <summary className="cursor-pointer">Review template starter contents</summary>
    {template.version === 2 && <details className="mt-2"><summary>Review declared questions, conditions and requirements</summary><pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans">{JSON.stringify(template.program, null, 2)}</pre></details>}
    <ol className="mt-2 list-decimal space-y-3 pl-5">
      {template.members.map((member, index) => <li key={index} className="break-words">
        <p>{member.label} · {member.role} · {member.required ? 'required' : 'optional'}</p>
        {member.kind === 'attachment' ? <p>Upload a fresh PDF for this slot.</p> : <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans">{
          documentTextFields(member.draft as unknown as DocumentFieldSource, 'share').filter(field => field.text.trim()).map(field => `${field.label}: ${field.text}`).join('\n')
        }</pre>}
        {member.kind === 'native' && (member.requiredFiles ?? []).map((file, position) => <p key={position}>Fresh PDF required: {file.label}</p>)}
      </li>)}
    </ol>
  </details>;
}
/** Package starters have their own explicit creation and replacement steps. */
export function PackageTemplatePanel({ record, revisionId, busy, run, signal, isCurrent, onCreate }: Props) {
  const [templates, setTemplates] = useState<PackageTemplate[]>([]), [loaded, setLoaded] = useState(false), [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(''), [templateName, setTemplateName] = useState(''), [packageName, setPackageName] = useState('');
  const [starterReviewKey, setStarterReviewKey] = useState(''), [creationReviewed, setCreationReviewed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({}), [attachments, setAttachments] = useState<Record<string, TemplateAttachment>>({});
  const [notice, setNotice] = useState('');
  const [transfer, setTransfer] = useState<{ mode: 'import' | 'export'; template: PackageTemplate; policy: PolicyResolution; reviews: ExportReview[]; json: string } | null>(null);
  const [transferApproved, setTransferApproved] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let live = true;
    void listPackageTemplates().then(items => { if (live) { setTemplates(items); setLoaded(true); } })
      .catch(error => { if (live) setLoadError(error instanceof Error ? error.message : 'The template library could not be read.'); });
    return () => { live = false; alive.current = false; };
  }, []);
  const sourceKey = `${record?.id ?? ''}:${revisionId ?? record?.currentRevisionId ?? ''}`;
  const starterReviewed = starterReviewKey === sourceKey;
  const selected = templates.find(template => template.id === selectedId);
  const placeholders = selected ? packageTemplatePlaceholders(selected) : [];
  const fileSlots = selected ? packageTemplateFileSlots(selected) : [];
  const current = () => alive.current && isCurrent() && !signal()?.aborted;
  async function refresh(select?: PackageTemplate) {
    const items = await listPackageTemplates();
    if (!current()) return;
    setTemplates(items);
    if (select) choose(select);
  }
  function choose(template?: PackageTemplate) {
    setSelectedId(template?.id ?? ''); setTemplateName(template?.name ?? '');
    setPackageName(template ? `${template.name.slice(0, 113)} action` : '');
    setValues({}); setAttachments({}); setCreationReviewed(false); setTransfer(null); setTransferApproved(false); setNotice('');
  }
  function uploadFile(key: string, file: File) {
    void run(async () => {
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF no larger than 25 MB.');
      if (Object.entries(attachments).reduce((sum, [other, item]) => sum + (other === key ? 0 : item.data.byteLength), file.size) > MAX_TEMPLATE_ACTION_BYTES)
        throw new Error('Fresh package files exceed the combined 64 MB limit.');
      const data = await file.arrayBuffer(); if (!current()) return;
      setAttachments(before => ({ ...before, [key]: { name: file.name, data, signedOriginal: false } })); setCreationReviewed(false);
    });
  }
  const ready = !!selected && selected.version === 1 && !!packageName.trim() && creationReviewed && placeholders.every(key => values[key]?.trim())
    && fileSlots.every(slot => !slot.required || attachments[slot.key]);
  return <section className="min-w-0 space-y-3 rounded border p-3" aria-label="Reusable package templates">
    <h3 className="font-medium">Reusable package templates</h3>
    <p className="text-sm text-muted-foreground">Keep document starters and member order for the next action. Original PDFs and attached native PDFs become fresh upload slots. Starter text and figures are retained; signatures, feedback and source links are removed. Supply required replacements before creating the action.</p>
    {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <fieldset disabled={busy || !loaded} className="min-w-0 space-y-3">
      <label className="block text-sm">Template name<input aria-label="Template name" value={templateName} maxLength={120}
        className="mt-1 w-full rounded border bg-background p-2" onChange={event => setTemplateName(event.target.value)} /></label>
      {record && getPackageRevision(record, revisionId).members.length > 0 && <>
        <p className="text-sm">Save the selected revision of {record.name}. Replace person-specific starter text with {'{{PLACEHOLDERS}}'} in the source documents before saving.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={starterReviewed} onChange={event => setStarterReviewKey(event.target.checked ? sourceKey : '')} />I reviewed the source starter text and replaced information that must change for each action with placeholders.</label>
        <Button variant="outline" disabled={!templateName.trim() || !starterReviewed} onClick={() => void run(async () => {
          const saved = await capturePackageTemplate(record, revisionId ?? record.currentRevisionId, templateName, signal());
          await refresh(saved); if (current()) { setStarterReviewKey(''); setNotice('Package template saved.'); }
        })}>Save package template</Button>
      </>}
      <label className="block text-sm">Saved package templates<select aria-label="Saved package templates" value={selectedId}
        className="mt-1 w-full rounded border bg-background p-2" onChange={event => choose(templates.find(template => template.id === event.target.value))}>
        <option value="">Choose a package template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></label>
      <label className="block text-sm">Import package template<input aria-label="Import package template" type="file" accept=".json" className="mt-1 block max-w-full"
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => {
          setTransfer(null); setTransferApproved(false);
          if (file.size > MAX_PACKAGE_TEMPLATE_BYTES) throw new Error('Package templates are limited to 12 MB.');
          const json = await file.text(); if (!current()) return;
          const { validatePackageTemplate } = await import('@/lib/packageTemplateLibrary');
          const template = await validatePackageTemplate(JSON.parse(json));
          const policy = await getExportDeploymentPolicy();
          const reviews = await reviewTemplate(template, policy);
          if (current()) setTransfer({ mode: 'import', template, policy, reviews, json });
        }); }} /></label>
      {selected && <>
        <StarterContents template={selected} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!templateName.trim()} onClick={() => void run(async () => { const renamed = await renamePackageTemplate(selected, templateName, signal()); await refresh(renamed); })}>Rename template</Button>
          <Button variant="outline" onClick={() => void run(async () => { await deletePackageTemplate(selected, signal()); await refresh(); if (current()) { choose(); setNotice('Package template deleted. Existing packages are preserved.'); } })}>Delete template</Button>
          <Button variant="outline" onClick={() => void run(async () => {
            setTransfer(null); setTransferApproved(false);
            const policy = await getExportDeploymentPolicy(); const reviews = await reviewTemplate(selected, policy);
            const json = await exportPackageTemplate(selected);
            if (current()) setTransfer({ mode: 'export', template: selected, policy, reviews, json });
          })}>Review template export</Button>
        </div>
        {selected.version === 2 && <p role="status" className="text-sm">This versioned template requires the conditional intake workflow. Its declarations can be reviewed and transferred here.</p>}
        {selected.version === 1 && <>
        <label className="block text-sm">New action name<input aria-label="New action name" value={packageName} maxLength={120} className="mt-1 w-full rounded border bg-background p-2" onChange={event => setPackageName(event.target.value)} /></label>
        {placeholders.map(key => <label key={key} className="block text-sm">{key}<input aria-label={`Template value ${key}`} value={values[key] ?? ''} maxLength={10000}
          className="mt-1 w-full rounded border bg-background p-2" onChange={event => { setValues(before => ({ ...before, [key]: event.target.value })); setCreationReviewed(false); }} /></label>)}
        {fileSlots.map(slot => <div key={slot.key} className="space-y-1 rounded border p-2 text-sm">
          <label className="block">{slot.label} ({slot.required ? 'required PDF' : 'optional PDF'})<input type="file" aria-label={`Fresh PDF for ${slot.label}`} accept=".pdf,application/pdf" className="mt-1 block max-w-full"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) uploadFile(slot.key, file); }} /></label>
          {attachments[slot.key] && <><p>{attachments[slot.key].name}</p>{!slot.native && <label className="flex items-start gap-2"><input type="checkbox" checked={attachments[slot.key].signedOriginal}
            onChange={event => { const checked = event.target.checked; setAttachments(before => ({ ...before, [slot.key]: { ...before[slot.key], signedOriginal: checked } })); setCreationReviewed(false); }} />This uploaded PDF is a signed original.</label>}
            <Button variant="ghost" onClick={() => { setAttachments(before => Object.fromEntries(Object.entries(before).filter(([key]) => key !== slot.key))); setCreationReviewed(false); }}>Remove uploaded PDF</Button></>}
        </div>)}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={creationReviewed} onChange={event => setCreationReviewed(event.target.checked)} />I reviewed the retained starter contents, supplied fresh values and selected the correct attachments for this new action.</label>
        <Button disabled={!ready} onClick={() => void run(async () => {
          const created = await instantiatePackageTemplate(selected, packageName, values, attachments, signal());
          if (current()) { onCreate(created); setValues({}); setAttachments({}); setCreationReviewed(false); setNotice('Fresh package created. Open its native members to review the completed text and fresh attachments.'); }
        })}>Create package from template</Button>
        </>}
      </>}
      {transfer && <div className="space-y-2 rounded border p-2 text-sm">
        <p>Review template {transfer.mode}: {transfer.template.name}</p>
        <StarterContents template={transfer.template} />
        {transfer.reviews.map((review, index) => <div key={index}>{review.notices.map((notice, index) => <p key={index} className="whitespace-pre-wrap break-words">{notice}</p>)}
          {review.privacy.findings.map((finding, index) => <p key={index} className="break-words">{finding.type}: {finding.value}</p>)}</div>)}
        <p>Inspect any retained figures manually. Template files are unencrypted.</p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={transferApproved} onChange={event => setTransferApproved(event.target.checked)} />I reviewed this template's retained text, figures, markings and privacy findings for transfer.</label>
        <div className="flex flex-wrap gap-2"><Button disabled={!transferApproved} onClick={() => void run(async () => {
          const policy = await getExportDeploymentPolicy(); if (!current()) return;
          if (!samePolicy(transfer.policy, policy)) throw new Error('The deployment policy changed. Review the template transfer again.');
          await reviewTemplate(transfer.template, policy);
          for (const member of transfer.template.members) if (member.kind === 'native') assertRetainedDocumentTextPolicy(member.draft as unknown as DocumentFieldSource, policy);
          if (!samePolicy(policy, getExportDeploymentPolicySync()) || !current()) throw new Error('The deployment policy changed. Review the template transfer again.');
          if (transfer.mode === 'import') await refresh(await importPackageTemplate(transfer.json, signal(), () => current() && samePolicy(policy, getExportDeploymentPolicySync())));
          else triggerDownload(new TextEncoder().encode(transfer.json), 'dondocs-package-template.json', 'application/json');
          if (current()) { setTransfer(null); setTransferApproved(false); setNotice(transfer.mode === 'import' ? 'Package template imported.' : 'Package template downloaded.'); }
        })}>{transfer.mode === 'import' ? 'Import reviewed package template' : 'Download reviewed package template'}</Button>
          <Button variant="outline" onClick={() => { setTransfer(null); setTransferApproved(false); }}>Cancel template transfer</Button></div>
      </div>}
    </fieldset>
  </section>;
}
