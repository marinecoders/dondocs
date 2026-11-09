import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { idbGetAllDocuments } from "@/lib/documentsDb";
import { useDocumentsStore } from "@/stores/documentsStore";
import { FORMS_PERSIST_KEY } from "@/stores/formStore";
import { useProfileStore } from "@/stores/profileStore";
it("does not manufacture legacy form drafts on a fresh first startup during a no-op compatibility repair", async () => {
  localStorage.clear();
  sessionStorage.clear();
  useProfileStore.setState({ profiles: {}, selectedProfile: null });
  useDocumentsStore.setState({
    docs: {},
    trash: {},
    currentId: null,
    baseline: null,
    hydrated: false,
    activationEpoch: 0,
  });
  expect(localStorage.getItem(FORMS_PERSIST_KEY)).toBeNull();
  expect(await idbGetAllDocuments()).toEqual([]);
  await useDocumentsStore.getState().init();
  expect(await idbGetAllDocuments()).toEqual([]);
  expect(Object.keys(useDocumentsStore.getState().docs)).toEqual([]);
  expect(localStorage.getItem(FORMS_PERSIST_KEY)).toBeNull();
});
