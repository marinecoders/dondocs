import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { compressedLocalStorage } from '@/lib/compressedStorage';
import type { SerializedSession } from './documentStore';

/**
 * User-saved document templates. A template is a captured SerializedSession (the
 * same payload a share link / Recents entry carries), so loading one restores
 * the full document via loadSharedSession. Persisted to compressed localStorage
 * like profiles; enclosure files are not part of the session and aren't saved.
 */
export interface UserTemplate {
  id: string;
  name: string;
  docType: string;
  createdAt: number;
  session: SerializedSession;
}

const newTemplateId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `tpl_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;

interface UserTemplatesState {
  templates: Record<string, UserTemplate>;
  /** Capture a session as a new named template. Returns the new id. */
  saveTemplate: (name: string, session: SerializedSession) => string;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, name: string) => void;
}

export const useUserTemplatesStore = create<UserTemplatesState>()(
  persist(
    (set) => ({
      templates: {},

      saveTemplate: (name, session) => {
        const id = newTemplateId();
        const template: UserTemplate = {
          id,
          name: name.trim() || 'Untitled template',
          docType: session.docType,
          createdAt: Date.now(),
          session,
        };
        set((s) => ({ templates: { ...s.templates, [id]: template } }));
        return id;
      },

      deleteTemplate: (id) =>
        set((s) => {
          const templates = { ...s.templates };
          delete templates[id];
          return { templates };
        }),

      renameTemplate: (id, name) =>
        set((s) => {
          const t = s.templates[id];
          if (!t) return s;
          return { templates: { ...s.templates, [id]: { ...t, name: name.trim() || t.name } } };
        }),
    }),
    {
      name: 'dondocs_user_templates',
      storage: createJSONStorage(() => compressedLocalStorage),
    }
  )
);
