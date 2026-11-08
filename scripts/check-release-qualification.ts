import { readFile } from 'node:fs/promises';
import { checkQualification, releaseSourceDigest } from './release-qualification';
const digest = await releaseSourceDigest();
if (process.argv.includes('--digest')) console.log(digest);
else {
  checkQualification(JSON.parse(await readFile('.github/release-qualification.json', 'utf8')), digest, process.env.DONDOCS_PRODUCTION_URL);
  console.log('Release qualification matches the current source and production host');
}
