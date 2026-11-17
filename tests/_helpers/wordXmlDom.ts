import { DOMParser as XmlParser } from '@xmldom/xmldom';
import { afterAll, beforeAll } from 'vitest';

/** happy-dom does not implement XML attribute namespaces. Use a real XML DOM
 * for reader units; native browser scenarios independently cover the web DOM. */
export function installWordXmlDom(): void {
  const original = globalThis.DOMParser;
  beforeAll(() => {
    globalThis.DOMParser = class {
      parseFromString(source: string, type: DOMParserSupportedType): Document {
        const fail = (message: string) => { throw new Error(message); };
        return new XmlParser({ errorHandler: { warning: fail, error: fail, fatalError: fail } }).parseFromString(source, type) as unknown as Document;
      }
    } as typeof DOMParser;
  });
  afterAll(() => { globalThis.DOMParser = original; });
}
