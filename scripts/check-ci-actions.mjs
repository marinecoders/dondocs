import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const commitReference = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[a-fA-F0-9]{40}$/;
const dockerReference = /^docker:\/\/[^\s@]+@sha256:[a-fA-F0-9]{64}$/;

export function referenceProblem(reference, kind) {
  if (typeof reference !== 'string') return 'uses must be a literal string';
  if (reference.startsWith('./')) {
    const parts = reference.slice(2).split('/');
    if (parts.some((part) => !part || part === '.' || part === '..') || /[\s@\\$]/.test(reference)) {
      return 'local uses must stay within the checked-out repository';
    }
    if (kind === 'workflow' && !/^\.\/\.github\/workflows\/[^/]+\.ya?ml$/.test(reference)) {
      return 'local reusable workflows must be in .github/workflows';
    }
    return null;
  }
  if (kind === 'action' && dockerReference.test(reference)) return null;
  if (commitReference.test(reference)) return null;
  return kind === 'workflow'
    ? 'external reusable workflows must use a full 40-character commit SHA'
    : 'external actions must use a full 40-character commit SHA (Docker actions require a sha256 digest)';
}

function references(document, kind) {
  const found = [];
  const steps = (items, location) => {
    for (const [index, step] of (Array.isArray(items) ? items : []).entries()) {
      if (step && Object.hasOwn(step, 'uses')) {
        found.push({ reference: step.uses, kind: 'action', location: `${location}[${index}].uses` });
      }
    }
  };
  if (kind === 'action') {
    if (document?.runs?.using === 'composite') steps(document.runs.steps, 'runs.steps');
  } else {
    if (!document?.jobs || typeof document.jobs !== 'object') throw new Error('workflow must define jobs');
    for (const [jobName, job] of Object.entries(document.jobs)) {
      if (job && Object.hasOwn(job, 'uses')) {
        found.push({ reference: job.uses, kind: 'workflow', location: `jobs.${jobName}.uses` });
      }
      steps(job?.steps, `jobs.${jobName}.steps`);
    }
  }
  return found;
}

export function checkRepository(root) {
  const repository = realpathSync(root);
  const workflowDirectory = path.join(repository, '.github/workflows');
  const pending = readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => ({ file: path.join(workflowDirectory, name), kind: 'workflow' }));
  const visited = new Set();
  const errors = [];
  let count = 0;
  if (!pending.length) errors.push('.github/workflows: no workflow files found');
  while (pending.length) {
    const { file, kind } = pending.shift();
    const label = path.relative(repository, file);
    try {
      const realFile = realpathSync(file);
      if (!realFile.startsWith(`${repository}${path.sep}`)) throw new Error('local reference escapes the repository');
      if (visited.has(realFile)) continue;
      visited.add(realFile);
      const document = yaml.load(readFileSync(realFile, 'utf8'));
      for (const entry of references(document, kind)) {
        count += 1;
        const problem = referenceProblem(entry.reference, entry.kind);
        if (problem) {
          errors.push(`${label}: ${entry.location}: ${problem}: ${JSON.stringify(entry.reference)}`);
        } else if (entry.reference.startsWith('./')) {
          let localFile = path.join(repository, entry.reference);
          if (entry.kind === 'action') {
            localFile = ['action.yml', 'action.yaml'].map((name) => path.join(localFile, name)).find(existsSync);
            if (!localFile) throw new Error(`${entry.location}: local action metadata not found: ${entry.reference}`);
          }
          pending.push({ file: localFile, kind: entry.kind });
        }
      }
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  }
  return { errors, count, files: visited.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkRepository(process.cwd());
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log(`CI references OK: ${result.count} references across ${result.files} workflow/action files`);
  }
}
