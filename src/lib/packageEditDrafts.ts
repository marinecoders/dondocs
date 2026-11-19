import { idbComparePackageEditDraft, idbReadPackageEditDraft } from './documentsDb';

const queues = new Map<string, Promise<unknown>>();

function serialize<T>(scope: string, action: () => Promise<T>): Promise<T> {
  const result = (queues.get(scope) ?? Promise.resolve()).catch(() => undefined).then(action);
  queues.set(scope, result);
  void result.finally(() => { if (queues.get(scope) === result) queues.delete(scope); }).catch(() => undefined);
  return result;
}

export function packageEditDraftScope(packageId: string, revisionId: string, area: 'information' | 'intake'): string {
  return JSON.stringify([packageId, revisionId, area]);
}

export async function openPackageEditDraft(scope: string) {
  const stored = await serialize(scope, () => idbReadPackageEditDraft(scope));
  const valid = stored !== null && typeof stored === 'object' && 'token' in stored && typeof stored.token === 'string' && 'value' in stored;
  let token: unknown = stored && typeof stored === 'object' && 'token' in stored ? stored.token : null;
  let unreadable = stored !== null && !valid;
  return {
    value: valid ? stored.value : null,
    error: unreadable ? 'This local draft could not be read. The saved package is unchanged.' : '',
    save(value: unknown | null): Promise<void> {
      if (unreadable && value !== null) return Promise.reject(new Error('Discard the unreadable local draft before saving new recovery data.'));
      const captured = value === null ? null : { token: crypto.randomUUID(), value: structuredClone(value) };
      return serialize(scope, async () => {
        if (!await idbComparePackageEditDraft(scope, token, captured))
          throw new Error('Another window changed this draft. Reopen the package to recover its latest edits.');
        token = captured?.token ?? null; unreadable = false;
      });
    },
  };
}
