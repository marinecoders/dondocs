import { verifyPublicationWordInputs } from './publication-word-receipts';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: vite-node scripts/verify-publication-word.mts OUTPUT_DIRECTORY');
const manifest = await verifyPublicationWordInputs(directory);
console.log(`Verified ${manifest.fixtures.length} DOCX/source receipts and ${manifest.rendererSources.length} renderer source digests.`);
