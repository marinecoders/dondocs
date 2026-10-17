import { resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { formDefinitionSchema, compileFormDefinition } from '../src/services/forms/model';
import { preparePackage, checkPackage, reviewPackage, publishPackage, retirePackage } from './form-package-lib';

const args = process.argv.slice(2).filter(v => v !== '--');
const [command, folder] = args;
const root = resolve('public/templates');
const option = (name: string) => args[args.indexOf(name) + 1];
switch (command) {
  case 'prepare': await preparePackage(root, folder); console.log(`Prepared ${folder}; review form.candidate.json, changes.json and overlays.`); break;
  case 'check': await checkPackage(root, folder); break;
  case 'review':
    if (!args.includes('--reviewer') || !args.includes('--notes')) throw new Error('Provide --reviewer and --notes');
    await reviewPackage(root, folder, option('--reviewer'), option('--notes'), args.includes('--accept-warnings')); break;
  case 'publish': console.log(publishPackage(root, folder, resolve('scripts'))); break;
  case 'retire': retirePackage(root, folder, resolve('scripts')); break;
  case 'validate': compileFormDefinition(JSON.parse(readFileSync(folder, 'utf8'))); break;
  case 'schema': writeFileSync(folder, JSON.stringify(z.toJSONSchema(formDefinitionSchema), null, 2) + '\n'); break;
  default: throw new Error('Usage: npm run form-package -- prepare|check|review|publish|retire|validate|schema <folder-or-file>');
}
