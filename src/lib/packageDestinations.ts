export interface PackageDestination {
  revisionId?: string;
  section?: 'overview' | 'documents' | 'review' | 'delivery';
  panel?: 'information' | 'requirements' | 'intake' | 'consistency' | 'work' | 'signing';
  factId?: string;
  bindingId?: string;
  memberId?: string;
  requirementId?: string;
  intakeSlot?: string;
  signatureField?: string;
  outputId?: string;
  reviewRoundId?: string;
  citationId?: string;
  signingId?: string;
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
export function focusPackageDestination(root: ParentNode | null, attribute: 'data-package-fact-id' | 'data-package-binding-id' | 'data-package-requirement-id' | 'data-package-citation-id' | 'data-package-output-id' | 'data-package-review-id' | 'data-package-signing-id' | 'data-package-panel', identity: string): boolean {
  if (!root) return false;
  const target = [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(element => element.getAttribute(attribute) === identity);
  if (!target) return false;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
    if (parent === root) break;
  }
  // Scrolling also lays out rows just inserted for a historical revision. Firefox
  // can otherwise reject focus until the newly opened content has been laid out.
  target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  target.focus({ preventScroll: true });
  return target.ownerDocument.activeElement === target;
}
