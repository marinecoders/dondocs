import { letterSchema } from '../../companion/letterSchema';
import { volumeFixture } from './volumeFixture';

/** A complete volume request for the public companion render surface. */
export function companionVolume() {
  const source = volumeFixture();
  return letterSchema.parse({
    docType: source.docType,
    format: 'pdf',
    out: 'technical_volume.pdf',
    subject: source.formData.subject,
    date: source.formData.date,
    volume: source.formData.volume,
    paragraphs: source.paragraphs,
  });
}
