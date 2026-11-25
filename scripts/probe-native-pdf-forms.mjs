import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = `Usage: node scripts/probe-native-pdf-forms.mjs <pdf-or-directory> [...]

Tests one representative of each supported editable field type per original PDF.
Directories are scanned one level deep. Byte-identical copies are counted once.
A passed result covers sampled values and PDF.js-reported appearances only.
The report is written to stdout as JSON. Test edits stay in memory.`;

async function listPdfs(inputs) {
  const files = new Set();
  for (const input of inputs) {
    const path = resolve(input);
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.filter(entry => entry.isFile() && /\.pdf$/i.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        files.add(join(path, entry.name));
      }
    } else if (info.isFile() && /\.pdf$/i.test(path)) {
      files.add(path);
    } else {
      throw new Error(`Expected a PDF file or directory: ${input}`);
    }
  }
  return files;
}

async function withPdf(pdfjs, bytes, inspect) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, stopAtErrors: true, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    return await inspect(await task.promise);
  } finally {
    await task.destroy();
  }
}

async function readWidgets(pdf) {
  const widgets = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const annotations = await page.getAnnotations({ intent: 'display' });
    widgets.push(...annotations.filter(annotation => annotation.subtype === 'Widget'));
    page.cleanup();
  }
  return widgets;
}

function fieldType(widget) {
  if (widget.fieldType === 'Tx') return 'text';
  if (widget.fieldType === 'Ch') return widget.combo ? 'dropdown' : 'list';
  if (widget.fieldType === 'Btn' && widget.checkBox) return 'checkbox';
  if (widget.fieldType === 'Btn' && widget.radioButton) return 'radio';
  return undefined;
}

function sampleValue(widget, type) {
  if (type === 'text') {
    const value = widget.fieldValue === '7' ? '8' : '7';
    return { value, expected: value };
  }
  if (type === 'dropdown' || type === 'list') {
    const option = widget.options?.find(({ exportValue }) => typeof exportValue === 'string' && exportValue.trim()
      && !(Array.isArray(widget.fieldValue) ? widget.fieldValue.includes(exportValue) : widget.fieldValue === exportValue));
    if (!option) return undefined;
    const expected = option.exportValue;
    return { value: widget.multiSelect ? [expected] : expected, expected };
  }
  if (type === 'checkbox' && widget.exportValue) {
    const value = widget.fieldValue !== widget.exportValue;
    return { value, expected: value ? widget.exportValue : 'Off' };
  }
  if (type === 'radio' && widget.buttonValue && widget.fieldValue !== widget.buttonValue) {
    return { value: true, expected: widget.buttonValue };
  }
  return undefined;
}

function equalValue(actual, expected) {
  // PDF.js exposes a single selected choice as an array on the widget.
  return (Array.isArray(actual) && actual.length === 1 ? actual[0] : actual) === expected;
}

function widgetInventory(widgets, fields) {
  return JSON.stringify([Object.keys(fields ?? {}).sort(),
    widgets.map(widget => [widget.id, widget.fieldName, widget.fieldType])]);
}

async function probeForm(pdfjs, bytes) {
  const original = await withPdf(pdfjs, bytes, async pdf => {
    const { info } = await pdf.getMetadata();
    const pages = pdf.numPages;
    if (info.IsXFAPresent) return { status: 'xfa', pages };
    const widgets = await readWidgets(pdf);
    const fields = await pdf.getFieldObjects();
    const signatureWidgets = widgets.filter(widget => widget.fieldType === 'Sig').length;
    const report = { pages, fields: Object.keys(fields ?? {}).length, widgets: widgets.length, signatureWidgets };
    if (!widgets.length && !report.fields) return { ...report, status: 'flat' };
    const permissions = await pdf.getPermissions();
    const { FILL_INTERACTIVE_FORMS, MODIFY_ANNOTATIONS } = pdfjs.PermissionFlag;
    if (permissions && !permissions.includes(FILL_INTERACTIVE_FORMS) && !permissions.includes(MODIFY_ANNOTATIONS)) {
      return { ...report, status: 'fill-restricted' };
    }

    const samples = new Map();
    const editableTypes = new Set();
    for (const widget of widgets) {
      const type = fieldType(widget);
      const isBound = widget.fieldName && Object.hasOwn(fields ?? {}, widget.fieldName)
        && fields[widget.fieldName].some(field => field.id === widget.id);
      if (!type || widget.readOnly || widget.hidden) continue;
      editableTypes.add(type);
      if (!isBound || samples.has(type)) continue;
      const sample = sampleValue(widget, type);
      if (!sample) continue;
      samples.set(type, { ...sample, type, name: widget.fieldName, id: widget.id });
      pdf.annotationStorage.setValue(widget.id, { value: sample.value });
    }
    const untestedTypes = [...editableTypes].filter(type => !samples.has(type));
    if (!samples.size) return { ...report, untestedTypes, status: 'no-testable-fields' };
    const saved = Buffer.from(await pdf.saveDocument());
    if (saved.length <= bytes.length || !saved.subarray(0, bytes.length).equals(bytes)) {
      return { ...report, status: 'source-bytes-changed' };
    }
    return { report, untestedTypes, inventory: widgetInventory(widgets, fields), samples: [...samples.values()], saved };
  });
  if (!original.saved) return original;

  return withPdf(pdfjs, original.saved, async pdf => {
    const { report, samples } = original;
    const widgets = await readWidgets(pdf);
    const fields = await pdf.getFieldObjects();
    const sameInventory = pdf.numPages === report.pages && widgetInventory(widgets, fields) === original.inventory;
    const checks = samples.map(({ name, id, type, expected }) => {
      const widget = widgets.find(widget => widget.id === id);
      const field = fields?.[name]?.find(field => field.id === id);
      return { type, name, valueRetained: equalValue(field?.value, expected) && equalValue(widget?.fieldValue, expected),
        hasAppearance: widget?.hasAppearance === true };
    });
    const passed = checks.filter(check => check.valueRetained && check.hasAppearance).length;
    let status = 'failed';
    if (!sameInventory) status = 'inventory-changed';
    else if (passed === checks.length && !original.untestedTypes.length) status = 'passed';
    else if (passed > 0) status = 'partial';
    return { ...report, status, checks, untestedTypes: original.untestedTypes };
  });
}

async function main(inputs) {
  if (inputs.includes('--help') || inputs.includes('-h')) {
    console.log(usage);
    return;
  }
  if (!inputs.length) throw new Error(usage);
  const files = await listPdfs(inputs);
  if (!files.size) throw new Error('No PDFs found in the supplied directories.');

  // Resolve the version used by the app, which can differ from the root copy.
  const require = createRequire(import.meta.url);
  const requireFromReactPdf = createRequire(require.resolve('react-pdf/package.json'));
  const pdfjs = await import(pathToFileURL(requireFromReactPdf.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const inspected = new Map();
  const results = [];
  for (const path of files) {
    try {
      const bytes = await readFile(path);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const duplicateOf = inspected.get(sha256);
      if (duplicateOf) {
        results.push({ path, status: 'duplicate', duplicateOf });
        continue;
      }
      inspected.set(sha256, path);
      results.push({ path, sha256, ...await probeForm(pdfjs, bytes) });
    } catch (error) {
      const status = error.name === 'PasswordException' ? 'opening-password' : 'error';
      results.push({ path, status, error: error.message });
    }
  }
  const totals = {};
  for (const { status } of results) totals[status] = (totals[status] ?? 0) + 1;
  console.log(JSON.stringify({ pdfjsVersion: pdfjs.version, totals, results }, null, 2));
}

await main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
