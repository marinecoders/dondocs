// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localModuleInputs, publicationWordInputPaths, publicationWordSourceDigests, verifyPublicationWordSources } from '../../scripts/publication-word-inputs';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('publication Word qualification inputs', () => {
  it('binds the real renderer dependencies, fixture builders, locked packages and bundled seal', async () => {
    const paths = await publicationWordInputPaths();
    for (const path of ['src/data/techpub/manualStatements.ts', 'src/lib/publicationReferences.ts', 'src/services/docx/imageAssets.ts',
      'tests/_helpers/companionPublication.ts', 'companion/letterInput.ts', 'public/attachments/usmc-seal.png', 'package-lock.json', 'scripts/publication-word-inputs.ts']) {
      expect(paths).toContain(path);
    }
    expect(paths.some(path => path.includes('node_modules'))).toBe(false);
  });

  it('invalidates retained receipts after a transitive statement or loaded image changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'publication-word-inputs-')); temporary.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', paths: { '@/*': ['./src/*'] } } }));
    await writeFile(join(root, 'src/index.ts'), "export { statement } from './frontMatter';\n");
    await writeFile(join(root, 'src/frontMatter.ts'), "export { statement } from '@/statements';\n");
    const statement = join(root, 'src/statements.ts'), image = join(root, 'seal.png');
    await writeFile(statement, "export const statement = 'Approved statement';\n");
    await writeFile(image, new Uint8Array([137, 80, 78, 71]));
    const required = [...await localModuleInputs(root, ['src/index.ts']), 'seal.png'].sort();
    const original = await publicationWordSourceDigests(required, root);
    await expect(verifyPublicationWordSources(original, required, root)).resolves.toBeUndefined();
    await writeFile(statement, "export const statement = 'Changed statement';\n");
    await expect(verifyPublicationWordSources(original, required, root)).rejects.toThrow('src/statements.ts: renderer changed');
    await writeFile(statement, "export const statement = 'Approved statement';\n");
    await writeFile(image, new Uint8Array([137, 80, 78, 72]));
    await expect(verifyPublicationWordSources(original, required, root)).rejects.toThrow('seal.png: renderer changed');
    await expect(verifyPublicationWordSources(original.filter(source => source.path !== 'seal.png'), required, root)).rejects.toThrow('inventory is incomplete');
  });

  it('follows runtime imports and re-exports without expanding erased type-only module graphs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'publication-word-runtime-inputs-')); temporary.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'tsconfig.app.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' } }));
    await writeFile(join(root, 'src/index.ts'), [
      "import type { Snapshot } from './missing-type';",
      "import { type OtherSnapshot } from './missing-named-type';",
      "export type { ThirdSnapshot } from './missing-export-type';",
      "export { type FourthSnapshot } from './missing-named-export-type';",
      "export { statement } from './runtime';",
      "import { type Annotation, value } from './mixed';",
      "export const later = () => import('./dynamic');",
      "import './side-effect';",
    ].join('\n'));
    for (const name of ['runtime', 'mixed', 'dynamic', 'side-effect']) await writeFile(join(root, `src/${name}.ts`), 'export const value = 1;\n');
    expect(await localModuleInputs(root, ['src/index.ts'])).toEqual(['src/dynamic.ts', 'src/index.ts', 'src/mixed.ts', 'src/runtime.ts', 'src/side-effect.ts']);
  });
});
