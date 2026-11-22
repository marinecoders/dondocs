import { idbReservePackageApprovalRequest } from './documentsDb';
import { approvalRouteId, type ApprovalAssignment, type ApprovalBinding } from './packageApprovalClient';
import { portableResourceDigest } from './portableResources';

export async function reservePackageApprovalRequest(
  origin: string, actor: string, binding: ApprovalBinding, assignments: readonly ApprovalAssignment[],
): Promise<string> {
  // Scope retries to the authenticated requester and exact operation. Keep
  // only a fingerprint and the route ID in browser storage.
  const fingerprint = await portableResourceDigest(new TextEncoder().encode(JSON.stringify([
    origin, actor, binding.packageId, binding.revisionId, binding.artifactSha256,
    assignments.map(({ assignee, dueAt }) => [assignee, dueAt ?? null]),
  ])).buffer);
  const result = approvalRouteId.safeParse(await idbReservePackageApprovalRequest(fingerprint));
  if (!result.success) throw new Error('The saved approval request ID could not be recovered.');
  return result.data;
}
