export interface PackageDestination {
  revisionId?: string;
  section?: 'overview' | 'documents' | 'review' | 'delivery';
  panel?: 'information' | 'requirements' | 'intake' | 'consistency' | 'work';
  factId?: string;
  bindingId?: string;
  memberId?: string;
  requirementId?: string;
  outputId?: string;
  reviewRoundId?: string;
  citationId?: string;
}

/** A destination belongs to one selected saved revision, including historical views. */
export interface PackageDestinationRequest extends PackageDestination {
  requestId: number;
  packageId: string;
  revisionId: string;
}

export function matchesPackageDestination(request: PackageDestinationRequest | undefined, packageId: string, revisionId: string): request is PackageDestinationRequest {
  return request?.packageId === packageId && request.revisionId === revisionId;
}

/** Match attribute values directly so identifiers never become selector expressions. */
export function focusPackageDestination(root: ParentNode | null, attribute: 'data-package-fact-id' | 'data-package-binding-id' | 'data-package-requirement-id' | 'data-package-panel', identity: string): boolean {
  if (!root) return false;
  const target = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(element => element.getAttribute(attribute) === identity);
  if (!target) return false;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    if (parent === root) break;
  }
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  return true;
}
