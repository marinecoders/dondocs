import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { openPackageEditDraft } from '@/lib/packageEditDrafts';
import { getPackageRevision, type ActionPackage, type NativePackageMember } from '@/lib/actionPackages';
import { currentPackageFormRecord, packageFormValues, savePackageFormValues, type PackageFormValues } from '@/lib/packageFormEditing';
import { parseFormInstance } from '@/services/forms/model';
import { normalizeNavmc11811 } from '@/stores/formStore';

type Journal = Awaited<ReturnType<typeof openPackageEditDraft>>;
type Phase = 'opening' | 'saved' | 'pending' | 'saving' | 'error';

export function usePackageFormEditor(record: ActionPackage, member: NativePackageMember, onSave: (next: ActionPackage) => void) {
  const [values, setValues] = useState(() => packageFormValues(member));
  const [phase, setPhase] = useState<Phase>('opening');
  const recovery = useRef<Journal | null>(null);
  const [canDiscardRecovery, setCanDiscardRecovery] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const state = useRef({ record, member, values, dirty: false, journal: null as Journal | null });
  const onSaved = useRef(onSave);
  useLayoutEffect(() => { onSaved.current = onSave; }, [onSave]);
  const running = useRef<Promise<boolean> | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const local = state.current;
    const scope = JSON.stringify([local.record.id, local.member.id, 'official-form']);
    void openPackageEditDraft(scope).then(journal => {
      if (abort.signal.aborted) return;
      recovery.current = journal;
      if (journal.error) throw new Error(journal.error);
      if (journal.value !== null) {
        const entry = journal.value as { revisionId: string; values: PackageFormValues };
        const form = local.member.session.genericForm;
        let restored: PackageFormValues;
        if (entry.values.kind === 'configured' && form) {
          const parsed = parseFormInstance({ ...form, answers: entry.values.answers, rows: entry.values.rows });
          restored = { kind: 'configured', answers: parsed.answers, rows: parsed.rows };
        } else if (entry.values.kind === 'page11' && local.member.session.forms?.navmc11811) {
          restored = { kind: 'page11', page11: normalizeNavmc11811(entry.values.page11) };
        } else throw new Error('The recovered answers do not match this form.');
        if (JSON.stringify(restored) !== JSON.stringify(local.values)) {
          local.values = restored; local.dirty = true; setValues(restored);
          if (entry.revisionId !== local.member.revisionId)
            throw new Error('Recovered input belongs to an older member revision. Your input is shown for comparison.');
        }
      }
      local.journal = journal;
      setReady(true);
      setPhase(local.dirty ? 'pending' : 'saved');
    }).catch(cause => {
      if (abort.signal.aborted) return;
      setCanDiscardRecovery(!!recovery.current);
      setError(cause instanceof Error ? cause.message : 'The local form draft could not be read.');
      setPhase('error');
    });
    const warn = (event: BeforeUnloadEvent) => { if (local.dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { abort.abort(); window.removeEventListener('beforeunload', warn); };
  }, []);

  async function discardRecovery() {
    const journal = recovery.current;
    const signal = controller.current?.signal;
    if (!journal || !signal || signal.aborted) return;
    try {
      await journal.save(null);
      if (signal.aborted) return;
      const local = state.current;
      local.values = packageFormValues(local.member);
      local.dirty = false;
      local.journal = journal;
      setValues(local.values);
      setReady(true);
      setCanDiscardRecovery(false);
      setPhase('saved');
      setError('');
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'The recovery draft could not be cleared.');
    }
  }

  function change(next: PackageFormValues) {
    const local = state.current;
    if (!local.journal || controller.current?.signal.aborted) return;
    local.values = next; local.dirty = true;
    setValues(next); setPhase('pending'); setError('');
    // The journal contains answers only. Package revisions retain ownership of the PDF and definition.
    void local.journal.save({ revisionId: local.member.revisionId, values: next }).catch(cause => {
      if (!controller.current?.signal.aborted && local.values === next && local.dirty) setError(cause.message);
    });
  }

  function flush(): Promise<boolean> {
    if (running.current) return running.current;
    const local = state.current;
    // A read-only recovery conflict has no new input to flush. Its journal stays intact.
    if (!local.dirty || !local.journal) return Promise.resolve(true);
    const journal = local.journal;
    const signal = controller.current?.signal;
    if (!journal || !signal || signal.aborted) return Promise.resolve(false);
    const save = async () => {
      try {
        while (local.dirty) {
          const editing = local.values;
          setPhase('saving'); setError('');
          await journal.save({ revisionId: local.member.revisionId, values: editing });
          const base = await currentPackageFormRecord(local.record, local.member);
          const next = await savePackageFormValues(base, local.member, editing, signal);
          signal.throwIfAborted();
          local.record = next;
          local.member = getPackageRevision(next).members.find(item => item.id === local.member.id) as NativePackageMember;
          onSaved.current(next);
          if (local.values === editing) {
            local.dirty = false;
            // If cleanup fails, the already committed answers are recognized on reopen.
            await journal.save(null).catch(() => undefined);
          }
        }
        if (!signal.aborted) setPhase('saved');
        return true;
      } catch (cause) {
        if (!signal.aborted) { setPhase('error'); setError(cause instanceof Error ? cause.message : 'The form could not be saved.'); }
        return false;
      } finally { running.current = null; }
    };
    running.current = save();
    return running.current;
  }

  return { values, change, flush, phase, error, ready, canDiscardRecovery, discardRecovery, latest: () => state.current.values };
}
