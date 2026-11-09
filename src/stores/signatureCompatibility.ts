import {
  materializeFormSignatureFallbacks,
  materializeSignatureFallback,
  materializeSignatureFallbacks,
} from "@/lib/signatureCompatibility";
import { compressedStringify } from "@/lib/compressedStorage";
import { STORAGE_KEYS } from "@/lib/constants";
import { getSavedSession, mutateSessionAssets } from "./documentStore";
import { useFormStore } from "./formStore";
import { useProfileStore } from "./profileStore";
import { useBatchStore } from "./batchStore";
import { useUserTemplatesStore } from "./userTemplatesStore";

function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Repair older stored representations without replacing concurrent edits. */
export async function materializeStoredSignatureFallbacks(): Promise<void> {
  const forms = useFormStore.getState();
  const profiles = useProfileStore.getState().profiles;
  const source = useBatchStore.getState().source;
  const templates = useUserTemplatesStore.getState().templates;
  const tasks: Promise<unknown>[] = [
    materializeFormSignatureFallbacks(forms.navmc10274).then((value) => {
      if (
        changed(forms.navmc10274, value) &&
        useFormStore.getState().navmc10274 === forms.navmc10274
      )
        mutateSessionAssets(() => useFormStore.setState({ navmc10274: value }));
    }),
    materializeFormSignatureFallbacks(forms.navmc11811).then((value) => {
      if (
        changed(forms.navmc11811, value) &&
        useFormStore.getState().navmc11811 === forms.navmc11811
      )
        mutateSessionAssets(() => useFormStore.setState({ navmc11811: value }));
    }),
    ...Object.entries(profiles).map(async ([name, profile]) => {
      const signatureImage = await materializeSignatureFallback(
        profile.signatureImage,
      );
      if (
        changed(profile.signatureImage, signatureImage) &&
        useProfileStore.getState().profiles[name] === profile
      )
        useProfileStore.setState((state) => ({
          profiles: {
            ...state.profiles,
            [name]: { ...profile, signatureImage },
          },
        }));
    }),
    ...Object.entries(templates).map(async ([id, template]) => {
      const session = await materializeSignatureFallbacks(template.session);
      if (
        changed(template.session, session) &&
        useUserTemplatesStore.getState().templates[id] === template
      )
        useUserTemplatesStore.setState((state) => ({
          templates: { ...state.templates, [id]: { ...template, session } },
        }));
    }),
  ];
  if (source && useBatchStore.getState().status !== "running")
    tasks.push(
      materializeSignatureFallbacks(source).then((value) => {
        const batch = useBatchStore.getState();
        if (
          changed(source, value) &&
          batch.source === source &&
          batch.status !== "running"
        )
          useBatchStore.setState({ source: value });
      }),
    );
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOCUMENT);
    const session = getSavedSession();
    if (raw && session)
      tasks.push(
        materializeSignatureFallbacks(session).then((value) => {
          if (
            changed(session, value) &&
            localStorage.getItem(STORAGE_KEYS.DOCUMENT) === raw
          )
            localStorage.setItem(
              STORAGE_KEYS.DOCUMENT,
              compressedStringify(value),
            );
        }),
      );
  } catch {
    /* A blocked legacy store does not hide readable library records. */
  }
  await Promise.allSettled(tasks);
}
