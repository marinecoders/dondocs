import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { rememberMenuSpace, takeMenuSpace } from '@/components/ui/variable-suggestion-state';

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });

/** A document as the menu leaves it: the insert, its space, and the caret after both. */
function afterMenuInsert(): EditorState {
  const state = EditorState.create({ doc: schema.node('doc', null, schema.text('reference (a) tail')) });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 14)));
}

describe('the space the @ menu adds', () => {
  it('stands in for the next Space, once', () => {
    const state = afterMenuInsert();
    rememberMenuSpace(state);
    expect(takeMenuSpace(state)).toBe(true);
    expect(takeMenuSpace(state)).toBe(false);
  });

  it('expires when the document changes', () => {
    const state = afterMenuInsert();
    rememberMenuSpace(state);
    expect(takeMenuSpace(state.apply(state.tr.insertText('x')))).toBe(false);
  });

  it('expires for a caret that moved away', () => {
    const state = afterMenuInsert();
    rememberMenuSpace(state);
    expect(takeMenuSpace(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))))).toBe(false);
  });

  it('does not swallow a Space that would replace a selection', () => {
    const state = afterMenuInsert();
    rememberMenuSpace(state);
    expect(takeMenuSpace(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 14, 18))))).toBe(false);
  });

  it('never applies when the menu inserted nothing in this document', () => {
    const state = afterMenuInsert();
    rememberMenuSpace(state);
    expect(takeMenuSpace(afterMenuInsert())).toBe(false);
  });
});
