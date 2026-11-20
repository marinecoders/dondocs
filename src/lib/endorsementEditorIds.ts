/** Editor identifiers are separate from persisted endorsement identities. */
export const FIRST_ENDORSEMENT_EDITOR_ID = 'first-endorsement';

export function additionalEndorsementEditorId(id: string): string {
  return `additional-endorsement-${id}`;
}
