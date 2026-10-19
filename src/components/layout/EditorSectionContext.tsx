import { createContext, useContext } from 'react';

/** Keep all field state mounted while presenting the selected editor section. */
export const EditorSectionContext = createContext<string | null>(null);
export const useVisibleEditorSection = () => useContext(EditorSectionContext);
