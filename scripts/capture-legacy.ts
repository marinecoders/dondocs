import { captureLegacyRelease } from './capture-legacy-release';
const [origin, output = '.release-previous'] = process.argv.slice(2);
if (!origin) throw new Error('Production origin required');
await captureLegacyRelease(origin, output);
