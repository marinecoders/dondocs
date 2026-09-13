// Mirror GitHub issues and pull requests into the Notion Tasks database.
//
// One row per issue/PR, keyed on the GitHub URL property. Only the number,
// title, state, draft flag, and labels cross over — never the body. Issue
// bodies are where people paste documents, and the tracker rule is
// "names, units, and what we want from people; nothing from any document".
//
// Runs from the notion-sync workflow: on issue/PR events it syncs that one
// item; on workflow_dispatch it backfills everything currently open.
// DRY_RUN=1 prints the rows it would write instead of calling Notion.

const NOTION_VERSION = '2025-09-03';

const token = process.env.NOTION_TOKEN;
const dataSource = process.env.NOTION_TASKS_DS;
const dryRun = process.env.DRY_RUN === '1';

// Type follows the same vocabulary the tracker uses by hand. PRs carry a
// conventional-commit prefix; issues carry the template's label, with a
// title fallback for the hand-written ones.
export function typeOf(item) {
  const labels = (item.labels ?? []).map(l => (typeof l === 'string' ? l : l.name).toLowerCase());
  if (labels.includes('bug')) return 'Bug';
  if (labels.includes('enhancement')) return 'Feature';
  if (labels.includes('dependencies')) return 'Chore';
  const prefix = /^(feat|fix|chore|build|ci|docs|test|refactor|perf|style)[(!:]/.exec(item.title)?.[1];
  if (prefix === 'fix') return 'Bug';
  if (prefix === 'feat') return 'Feature';
  if (prefix) return 'Chore';
  if (/^feature\b/i.test(item.title)) return 'Feature';
  return item.isPr ? 'Chore' : 'Bug';
}

// Todo while it is open and nobody has moved it; a PR that is ready for
// review is being worked on; anything closed is done, merged or not.
export function statusOf(item) {
  if (item.state !== 'open') return 'Done';
  if (item.isPr && !item.draft) return 'Doing';
  return 'Todo';
}

export function rowFor(item, { withType }) {
  const props = {
    Task: { title: [{ text: { content: `#${item.number} ${item.title}` } }] },
    Status: { select: { name: statusOf(item) } },
    GitHub: { url: item.url },
  };
  if (withType) props.Type = { select: { name: typeOf(item) } };
  return props;
}

// Normalise the two shapes GitHub hands us (event payload vs REST list)
// into the one the mapping functions read.
export function itemFrom(raw) {
  const isPr = 'pull_request' in raw || raw.html_url?.includes('/pull/');
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    draft: !!raw.draft,
    labels: raw.labels ?? [],
    url: raw.html_url,
    isPr,
    bot: raw.user?.type === 'Bot',
  };
}

async function notion(path, body, method = 'POST') {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsert(item, { relabel }) {
  if (item.bot) return console.log(`skip #${item.number} (bot)`);
  if (dryRun) return console.log(`#${item.number}`, JSON.stringify(rowFor(item, { withType: true })));

  const found = await notion(`/data_sources/${dataSource}/query`, {
    filter: { property: 'GitHub', url: { equals: item.url } },
    page_size: 1,
  });
  const existing = found.results[0];
  if (existing) {
    // Type is a human's call once the row exists; only a label change
    // on GitHub re-derives it.
    await notion(`/pages/${existing.id}`, { properties: rowFor(item, { withType: relabel }) }, 'PATCH');
    console.log(`updated #${item.number}`);
  } else {
    await notion('/pages', {
      parent: { type: 'data_source_id', data_source_id: dataSource },
      properties: rowFor(item, { withType: true }),
    });
    console.log(`created #${item.number}`);
  }
}

async function github(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res.json();
}

async function main() {
  if (!dryRun && (!token || !dataSource)) {
    throw new Error('NOTION_TOKEN and NOTION_TASKS_DS are required');
  }
  const eventName = process.env.GITHUB_EVENT_NAME;

  if (eventName === 'workflow_dispatch' || eventName === 'schedule') {
    // /issues returns PRs too, flagged by a pull_request key. The draft
    // flag only comes from /pulls, so fetch those separately.
    const repo = process.env.GITHUB_REPOSITORY;
    const issues = await github(`/repos/${repo}/issues?state=open&per_page=100`);
    const pulls = await github(`/repos/${repo}/pulls?state=open&per_page=100`);
    const items = [
      ...issues.filter(i => !i.pull_request),
      ...pulls,
    ].map(itemFrom);
    for (const item of items) await upsert(item, { relabel: false });
    return;
  }

  const { readFile } = await import('node:fs/promises');
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const raw = event.pull_request ?? event.issue;
  const item = itemFrom(raw);
  if (event.sender?.type === 'Bot') item.bot = true;
  await upsert(item, { relabel: ['labeled', 'unlabeled'].includes(event.action) });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
