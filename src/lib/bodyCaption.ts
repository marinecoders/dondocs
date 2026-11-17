/** Rich blocks only have a caption when at least one visible field has content.
 * Share this decision between the renderer and its semantic projection. */
export function hasBodyCaption(paragraph: { text: string; header?: string; portionMarking?: string }): boolean {
  return !!(paragraph.text.trim() || paragraph.header?.trim() || paragraph.portionMarking);
}
