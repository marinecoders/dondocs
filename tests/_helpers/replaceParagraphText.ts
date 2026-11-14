import type { Locator } from '@playwright/test';

export async function replaceParagraphText(paragraph: Locator, text: string): Promise<void> {
  // Select through the editor so ProseMirror and the DOM agree before typing.
  await paragraph.click({ clickCount: 3 });
  await paragraph.page().keyboard.insertText(text);
}
