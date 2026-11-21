import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('renders untrusted template metadata as text and binds the original identity without executing it', () => {
  document.body.innerHTML = '<div id="templateList"></div>';
  const html = readFileSync('tools/box-editor.html', 'utf8');
  const start = html.indexOf('function renderTemplateList() {');
  const end = html.indexOf('function setupEventListeners()', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const id = "x');globalThis.attacked=true;//";
  const name = '<img src=x onerror="globalThis.attacked=true">';
  const loadTemplate = vi.fn();
  const scope = { document, templates: [{ id, name, description: '<script>attack()</script>', pages: [] }], loadTemplate, attacked: false };
  runInNewContext(html.slice(start, end) + '\nrenderTemplateList();', scope);
  const button = document.querySelector('button')!;
  expect(button.textContent).toBe(name + '0 page(s) • <script>attack()</script>');
  expect(document.querySelectorAll('img,script')).toHaveLength(0);
  expect(button.getAttribute('onclick')).toBeNull();
  button.click();
  expect(loadTemplate).toHaveBeenCalledWith(id);
  expect(scope.attacked).toBe(false);
});
