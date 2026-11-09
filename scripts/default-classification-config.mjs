import { writeFile } from 'node:fs/promises';

// Keep deployment overrides local; emit an explicit default for offline builds.
try {
  await writeFile(new URL('../public/classification.config.json', import.meta.url), 'null\n', { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
