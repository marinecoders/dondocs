import type { ExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
import { assertExportDeploymentPolicy } from '@/lib/exportDeploymentPolicy';
declare const policy: ExportDeploymentPolicy;
// @ts-expect-error Issued policy decisions are immutable.
policy.allowedLevels.push('secret');
// @ts-expect-error Raw settings are not an issued policy.
assertExportDeploymentPolicy({ maxLevel: 'secret', allowedLevels: ['secret'] });
