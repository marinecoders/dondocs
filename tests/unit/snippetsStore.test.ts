import { describe, it, expect, beforeEach } from 'vitest';
import { useSnippetsStore } from '@/stores/snippetsStore';

describe('snippetsStore — reusable clause library', () => {
  beforeEach(() => {
    // Reset to a known small set for deterministic assertions.
    useSnippetsStore.setState({ snippets: [{ id: 'a', name: 'Alpha', text: 'Alpha text' }] });
  });

  it('adds a clause with an explicit name', () => {
    useSnippetsStore.getState().addSnippet('Bravo', 'Bravo body text');
    const s = useSnippetsStore.getState().snippets;
    expect(s).toHaveLength(2);
    expect(s[1].name).toBe('Bravo');
    expect(s[1].text).toBe('Bravo body text');
  });

  it('auto-names from the first words when no name is given', () => {
    useSnippetsStore.getState().addSnippet('', '  In accordance with reference (a), the following is submitted.  ');
    const added = useSnippetsStore.getState().snippets.at(-1)!;
    expect(added.text).toBe('In accordance with reference (a), the following is submitted.');
    expect(added.name).toContain('In accordance with reference');
  });

  it('ignores an empty clause', () => {
    useSnippetsStore.getState().addSnippet('X', '   ');
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
  });

  it('deletes a clause by id (deletions persist over the seeded defaults)', () => {
    useSnippetsStore.getState().deleteSnippet('a');
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
  });
});
