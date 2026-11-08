import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

const eslint = new ESLint();
it.each([
  "import { loadSharedSession } from '@/stores/documentStore'; export const replace = loadSharedSession;",
  "import { loadSharedSession } from '../../stores/documentStore'; export const replace = loadSharedSession;",
  "import { useHistoryStore } from '../../stores/historyStore'; export const history = useHistoryStore;",
  "import { useHistoryStore } from '@/stores/historyStore'; export const history = useHistoryStore;",
  "import { useDocumentStore } from '@/stores/documentStore'; useDocumentStore.setState({});",
  "import { useDocumentsStore } from '@/stores/documentsStore'; useDocumentsStore.getState().openLoadedAsNew();",
])('rejects a migrated UI bypass: %s', async code => {
  const [result] = await eslint.lintText(code, { filePath: 'src/components/layout/Header.tsx' });
  expect(result.messages.some(message => ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? ''))).toBe(true);
});
it('permits the scoped history facade', async () => {
  const [result] = await eslint.lintText("import { changeDocumentHistory, captureDocumentScope } from '@/stores/documentsStore'; export const undo = () => changeDocumentHistory('undo', captureDocumentScope());", { filePath: 'src/components/layout/Header.tsx' });
  expect(result.messages.filter(message => ['no-restricted-imports', 'no-restricted-syntax'].includes(message.ruleId ?? ''))).toEqual([]);
});
