import { sessionSearchFields } from '@/lib/workspaceSearch';
import type { SerializedSession } from '@/stores/documentStore';
declare const session: SerializedSession;
const fields = sessionSearchFields(session);
// @ts-expect-error A search consumer cannot change a captured navigation destination.
fields[0].sectionId = 'other';
// @ts-expect-error Search text is a read-only projection of the supplied data.
fields[0].text = 'other';
