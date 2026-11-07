import type { PreparedExportJob } from '@/lib/preparedExport';
import { executePreparedExport, type ExportArtifact } from '@/lib/exportExecution';
declare const prepared: PreparedExportJob;
declare const artifact: ExportArtifact;
// @ts-expect-error Execution requires approval for this prepared revision.
executePreparedExport(prepared, { render: async () => artifact, deliver: async () => true });
// @ts-expect-error Artifact completeness belongs to its renderer.
artifact.completeness = 'complete';
