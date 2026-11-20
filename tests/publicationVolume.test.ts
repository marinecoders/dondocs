import { describe, expect, it } from 'vitest';
import { emptyPublicationVolume, freshVolumeContent, moveVolumeNode, orderedVolumeBlocks, publicationVolumeErrors, publicationVolumeSchema, resolveVolumeReferences, validatePublicationVolume, volumeOutline, volumeReferenceToken } from '@/lib/publicationVolume';
import type { Paragraph } from '@/types/document';

describe('structured publication volumes', () => {
  it('retains body identities and authored content while chapters and appendices move', () => {
    const volume = emptyPublicationVolume();
    volume.chapters.push({ id: 'chapter-two', title: 'Maintenance', sections: [{ id: 'section-two', title: 'Checks' }] });
    volume.appendices.push({ id: 'appendix', title: 'Data', sections: [{ id: 'appendix-data', title: 'Limits' }] });
    const paragraphs: Paragraph[] = [
      { id: 'intro', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Original prose', level: 0 },
      { id: 'check', volumeSectionId: 'section-two', text: 'Check system.', level: 0 },
      { id: 'limit', volumeSectionId: 'appendix-data', text: 'Limits', level: 0 },
    ];
    const moved = { ...volume, chapters: moveVolumeNode(volume.chapters, 0, 1) };
    expect(orderedVolumeBlocks(moved, paragraphs).map(block => [block.paragraph.id, block.label])).toEqual([['check', '1.1.1'], ['intro', '2.1.1'], ['limit', 'A.1.1']]);
    expect(resolveVolumeReferences(`See ${volumeReferenceToken('intro')}.`, moved, paragraphs)).toBe('See 2.1.1.');
    expect(paragraphs[0]).toEqual({ id: 'intro', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Original prose', level: 0 });
  });
  it('rejects duplicate structural IDs, unassigned blocks and oversized input', () => {
    const volume = emptyPublicationVolume();
    expect(() => publicationVolumeSchema.parse({ ...volume, appendices: volume.chapters })).toThrow('unique');
    expect(() => validatePublicationVolume(volume, [{ id: 'block', text: 'Lost', level: 0 }])).toThrow('assigned');
    expect(() => validatePublicationVolume(volume, [{ id: volume.chapters[0].id, volumeSectionId: volume.chapters[0].sections[0].id, text: 'Duplicate', level: 0 }])).toThrow('identities');
    expect(() => publicationVolumeSchema.parse({ ...volume, chapters: Array.from({ length: 101 }, () => volume.chapters[0]) })).toThrow();
  });
  it('surfaces deleted cross-reference targets instead of replacing prose with guessed positions', () => {
    const volume = emptyPublicationVolume();
    const sectionId = volume.chapters[0].sections[0].id;
    const paragraph = { id: 'source', volumeSectionId: sectionId, text: volumeReferenceToken('deleted'), level: 0 };
    expect(publicationVolumeErrors(volume, [paragraph])).toContain('A volume reference has no target. Restore its target or replace the reference before exporting.');
    expect(resolveVolumeReferences(paragraph.text, volume, [paragraph])).toBe('[Missing reference]');
  });
  it('keeps independent table, figure and prose numbering within each section', () => {
    const volume = emptyPublicationVolume();
    const sectionId = volume.chapters[0].sections[0].id;
    const blocks = [{ id: 'p', text: 'Text', level: 0, volumeSectionId: sectionId }, { id: 'table', text: 'Data', level: 0, volumeSectionId: sectionId, bodyTable: { rows: [['Value']], headerRows: 0 } }, { id: 'figure', text: 'Image', level: 0, volumeSectionId: sectionId, figure: { name: 'image.png', placement: 'body' as const } }];
    expect(orderedVolumeBlocks(volume, blocks).map(block => block.label)).toEqual(['1.1.1', 'Table 1.1-1', 'Figure 1.1-1']);
    expect(volumeOutline(volume).map(node => node.kind)).toEqual(['chapter', 'section']);
  });
});

it('copies complete volume identities and remaps references while retaining dangling targets', () => {
  const volume = emptyPublicationVolume();
  const sectionId = volume.chapters[0].sections[0].id;
  volume.glossary.push({ id: 'glossary', term: 'System', definition: 'See {{VOLREF_body}}.' });
  volume.changes.push({ id: 'change', number: '1', date: '2026-11-20', description: 'Updated {{VOLREF_body}}.' });
  const paragraphs = [{ id: 'body', volumeSectionId: sectionId, text: `See ${volumeReferenceToken(volume.chapters[0].id)} and {{VOLREF_deleted}}.`, level: 0 }];
  const before = structuredClone({ volume, paragraphs });
  const copy = freshVolumeContent(volume, paragraphs);
  expect({ volume, paragraphs }).toEqual(before);
  expect(copy.volume.chapters[0].id).not.toBe(volume.chapters[0].id);
  expect(copy.paragraphs[0].id).not.toBe('body');
  expect(copy.paragraphs[0].volumeSectionId).toBe(copy.volume.chapters[0].sections[0].id);
  expect(copy.paragraphs[0].text).toContain(volumeReferenceToken(copy.volume.chapters[0].id));
  expect(copy.paragraphs[0].text).toContain('{{VOLREF_deleted}}');
  expect(copy.volume.glossary[0].definition).toContain(volumeReferenceToken(copy.paragraphs[0].id!));
  expect(copy.volume.changes[0].description).toContain(volumeReferenceToken(copy.paragraphs[0].id!));
  expect(validatePublicationVolume(copy.volume, copy.paragraphs)).toEqual(copy.volume);
});

it('copies a retained outline without binding ordinary correspondence blocks to it', () => {
  const volume = emptyPublicationVolume();
  const paragraphs: Paragraph[] = [
    { id: 'body', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Original volume text.', level: 0 },
    { id: 'ordinary', text: 'New correspondence: {{VOLREF_body}} and {{VOLREF_missing}}.', level: 0 },
  ];
  const before = structuredClone({ volume, paragraphs });
  const copy = freshVolumeContent(volume, paragraphs, { retained: true });
  expect(copy.volume.chapters[0].id).not.toBe(volume.chapters[0].id);
  expect(copy.paragraphs[0].volumeSectionId).toBe(copy.volume.chapters[0].sections[0].id);
  expect(copy.paragraphs[1].volumeSectionId).toBeUndefined();
  expect(copy.paragraphs[1].text).toBe(`New correspondence: ${volumeReferenceToken(copy.paragraphs[0].id!)} and {{VOLREF_missing}}.`);
  expect({ volume, paragraphs }).toEqual(before);
  expect(() => freshVolumeContent(volume, paragraphs)).toThrow('assigned');
});

it('rejects conflicting native blocks and identities shared with glossary records', () => {
  const volume = emptyPublicationVolume();
  const paragraph = { id: 'block', text: 'Data', volumeSectionId: volume.chapters[0].sections[0].id, level: 0 };
  expect(() => validatePublicationVolume(volume, [{ ...paragraph, bodyTable: { rows: [['x']], headerRows: 0 }, figure: { placement: 'body' } }])).toThrow('own native block');
  expect(() => validatePublicationVolume(volume, [{ ...paragraph, figure: {}, callout: 'note' }])).toThrow('own native block');
  expect(() => validatePublicationVolume(volume, [{ ...paragraph, bodyTable: { rows: [['x'], ['x', 'y']], headerRows: 0 } }])).toThrow('rectangular');
  volume.glossary.push({ id: 'block', term: 'Term', definition: 'Meaning' });
  expect(() => validatePublicationVolume(volume, [paragraph])).toThrow('identities');
});

it('refuses unsupported hidden content instead of omitting it from volume output', () => {
  const volume = emptyPublicationVolume();
  const paragraph = { id: 'block', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Data', level: 0 };
  expect(() => validatePublicationVolume(volume, [{ ...paragraph, portionMarking: 'UNKNOWN' }])).toThrow('portion marking');
  expect(() => validatePublicationVolume(volume, [{ ...paragraph, tableFootnotes: [{ id: '1', text: 'Must not vanish' }] }])).toThrow('footnotes');
  expect(publicationVolumeErrors(volume, [{ ...paragraph, text: '{{PUBREF_P_OLD}}' }])).toContain('Replace older publication references using the volume reference picker.');
});

it.each(['number', 'date'] as const)('validates references in the rendered change-record %s field', field => {
  const volume = emptyPublicationVolume();
  const paragraphs = [{ id: 'body', volumeSectionId: volume.chapters[0].sections[0].id, text: 'Retained content.', level: 0 }];
  volume.changes = [{ id: 'change', number: '1', date: '2026-11-20', description: 'Recorded change.' }];
  for (const [token, message] of [
    ['{{VOLREF_missing}}', 'no target'],
    ['{{VOLREF_broken target}}', 'malformed'],
    ['{{PUBREF_P_OLD}}', 'older publication references'],
  ]) {
    volume.changes[0][field] = token;
    expect(publicationVolumeErrors(volume, paragraphs).join(' ')).toContain(message);
  }
  volume.changes[0][field] = '{{VOLREF_body}}';
  expect(publicationVolumeErrors(volume, paragraphs)).toEqual([]);
});
