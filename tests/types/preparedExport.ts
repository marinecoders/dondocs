import type { PreparedExportJob, ReadyExportJob } from '@/lib/preparedExport';
import { copyPreparedDocument } from '@/lib/preparedExport';
declare const prepared: PreparedExportJob;
declare const ready: ReadyExportJob;
copyPreparedDocument(ready);
// @ts-expect-error An unreviewed job is not an execution capability.
copyPreparedDocument(prepared);
// @ts-expect-error Output identity cannot be relabeled after preparation.
ready.job.filename = 'other.pdf';
