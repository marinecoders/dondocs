import { describe, expect, it } from 'vitest';
import { generateAllLatexFiles } from '@/services/latex/generator';
import { volumeText } from '@/services/latex/volumeGenerator';
import { prepareExport } from '@/lib/preparedExport';
import { captureDocumentRevision } from '@/lib/capturedDocument';
import { resolveExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { publicationExportErrors } from '@/lib/publicationPreflight';
import { volumeFixture } from './_helpers/volumeFixture';

describe('volume PDF generation', () => {
  it('derives ordered body and linked references after a chapter move without changing saved text', () => {
    const source = volumeFixture();
    const original = JSON.stringify(source.paragraphs);
    source.formData.volume!.chapters.reverse();
    const { texFiles } = generateAllLatexFiles(source);
    expect(texFiles['body.tex'].indexOf('\\dondocsReferenceAnchor{volume.node.checks}')).toBeLessThan(texFiles['body.tex'].indexOf('\\dondocsReferenceAnchor{volume.node.intro}'));
    expect(texFiles['body.tex']).toContain('\\dondocsReferenceLink{volume.node.checks}{1.1.1}');
    expect(texFiles['body.tex']).toContain('\\dondocsReferenceLink{volume.node.intro}{2.1.1}');
    expect(texFiles['body.tex']).toContain('\\renewcommand{\\thepage}{A-\\arabic{page}}');
    expect(JSON.stringify(source.paragraphs)).toBe(original);
  });
  it('refuses missing references and figure bytes rather than emitting placeholders', () => {
    expect(() => volumeText('See {{VOLREF_deleted}}', new Map())).toThrow('no target');
    const source = volumeFixture();
    source.paragraphs.push({ id: 'missing-figure', volumeSectionId: 'section-data', text: 'Missing', level: 0, figure: {} });
    expect(() => generateAllLatexFiles(source)).toThrow('figure is missing');
  });
  it('keeps content limits and first-release output boundaries explicit', () => {
    const source = volumeFixture();
    expect(publicationExportErrors(source)).toEqual([]);
    source.formData.classLevel = 'secret';
    expect(publicationExportErrors(source).join(' ')).toContain('not qualified');
    source.formData.classLevel = 'cui';
    expect(publicationExportErrors(source).join(' ')).toContain('CUI designation');
    source.formData.signatureType = 'digital';
    expect(publicationExportErrors(source).join(' ')).toContain('external signing handoff');
  });
  it('preserves LaTeX-like authored text and both parts of a native table caption', () => {
    const source = volumeFixture();
    source.paragraphs[0].text = 'Literal \\input{outside} and 5% A&B.';
    source.paragraphs.find(paragraph => paragraph.bodyTable)!.header = 'Header title';
    const body = generateAllLatexFiles(source).texFiles['body.tex'];
    expect(body).not.toContain('Literal \\input{outside}');
    expect(body).toContain('Header title Measured values');
  });
  it('reports unsupported output text instead of silently removing authored characters', () => {
    const source = volumeFixture();
    source.paragraphs[0].text = 'Preserve 中文';
    expect(() => generateAllLatexFiles(source)).toThrow('font support');
    expect(publicationExportErrors(source).join(' ')).toContain('font support');
    source.paragraphs[0].text = 'Cafe\u0301, 5 § and 20°.';
    expect(() => generateAllLatexFiles(source)).not.toThrow();
    expect(source.paragraphs[0].text).toContain('e\u0301');
  });
});

it.each(['number', 'date'] as const)('blocks malformed and missing volume references in change %s before export preparation', field => {
  const policy = resolveExportDeploymentPolicy({ hostname: 'example.test', environment: null, runtime: { status: 'absent' } });
  for (const token of ['{{VOLREF_missing}}', '{{VOLREF_broken target}}', '{{PUBREF_P_OLD}}']) {
    const source = volumeFixture();
    source.formData.volume!.changes[0][field] = token;
    const captured = captureDocumentRevision({ documentId: 'volume-reference-readiness', epoch: 0, editSequence: 1, capturedAt: 1 }, source);
    const result = prepareExport({ id: `volume-change-${field}`, captured, target: 'pdf', filename: 'volume.pdf', policy });
    expect(result.status, `Readiness must reject ${token} in ${field}.`).toBe('error');
  }
});
