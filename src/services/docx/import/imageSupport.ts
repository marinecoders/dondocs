import { xmlChildren } from './archive';

const DRAWING_NAMESPACES = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);

/** The native body figure owns the original raster, not a rendered Word crop.
 * Reject appearance-changing DrawingML rather than exposing hidden source pixels
 * or claiming support for image-processing instructions that were not rendered. */
export function assertSupportedWordImage(drawing: Element): void {
  const reject = () => { throw new Error('This Word document contains a cropped or transformed image, or unsupported image-processing metadata. Flatten its visible appearance to a PNG or JPEG in Word, then import again. Nothing has been imported.'); };
  const elements = Array.from(drawing.getElementsByTagName('*')).filter(element => DRAWING_NAMESPACES.has(element.namespaceURI ?? ''));
  for (const element of elements) {
    if (['srcRect', 'fillRect'].includes(element.localName)) {
      for (const name of ['l', 't', 'r', 'b']) {
        const value = element.getAttribute(name) ?? '';
        if (element.hasAttribute(name) && (!/^[+-]?\d+$/.test(value) || Number(value) !== 0)) reject();
      }
    }
    if (element.localName === 'xfrm') {
      const rotation = element.getAttribute('rot') ?? '';
      if (element.hasAttribute('rot') && (!/^[+-]?\d+$/.test(rotation) || Number(rotation) !== 0)) reject();
      for (const name of ['flipH', 'flipV']) {
        const value = element.getAttribute(name) ?? '';
        if (element.hasAttribute(name) && !['0', 'false', 'off'].includes(value)) reject();
      }
    }
    if (element.localName === 'prstGeom' && element.getAttribute('prst') !== 'rect') reject();
    if (['custGeom', 'tile', 'effectDag', 'scene3d', 'sp3d'].includes(element.localName)) reject();
    if (element.localName === 'extLst') {
      // MS-ODRAWXML also stores artistic processing instructions here. Only the
      // documented DPI hint is supported; embedded cached pixels do not prove
      // that arbitrary extension instructions can safely be discarded.
      for (const extension of xmlChildren(element)) {
        const content = xmlChildren(extension);
        if (!DRAWING_NAMESPACES.has(extension.namespaceURI ?? '') || extension.localName !== 'ext'
          || extension.getAttribute('uri')?.replace(/[{}]/g, '').toUpperCase() !== '28A0092B-C50C-407E-A947-70E740481C1C'
          || content.length !== 1 || content[0].namespaceURI !== 'http://schemas.microsoft.com/office/drawing/2010/main'
          || content[0].localName !== 'useLocalDpi' || !['0', '1', 'true', 'false'].includes(content[0].getAttribute('val') ?? '')
          || xmlChildren(content[0]).length) reject();
      }
    }
    if (['blip', 'effectLst'].includes(element.localName)) {
      // Direct alpha/color effects and shadows are not reproduced. The
      // separate extension-list check permits only the known DPI hint.
      if (Array.from(element.childNodes).some(child => child.nodeType === 1 && !((child as Element).localName === 'extLst' && DRAWING_NAMESPACES.has((child as Element).namespaceURI ?? '')))) reject();
    }
  }
}
