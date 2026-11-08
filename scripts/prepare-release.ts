import { prepareRelease } from './retained-releases';
const [candidate = 'dist', output = 'release-site', previous] = process.argv.slice(2);
if (!previous && process.env.DONDOCS_BOOTSTRAP !== '1') throw new Error('Previous deployment required. Set DONDOCS_BOOTSTRAP=1 only for the initial managed deployment.');
console.log(await prepareRelease(candidate, output, previous, { bootstrap: process.env.DONDOCS_BOOTSTRAP === '1' }));
