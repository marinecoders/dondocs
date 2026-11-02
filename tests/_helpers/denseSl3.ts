import sharp from 'sharp';
import { populatedSl3Input } from './populatedSl3';
import { sl3Fixture } from './sl3Fixture';

/** Synthetic artwork; 15 items on the first sheet, 16 on its continuation. */
export async function denseSl3Input(orientation: 'portrait' | 'landscape', perPage: 1 | 2 | 4 | 8 | 12 | 16 = 16) {
  const input = await populatedSl3Input(orientation);
  input.publication!.endItems = input.publication!.endItems!.slice(0, 6);
  const data = input.publication!.sl3!;
  data.illustrationsPerPage = perPage;
  data.rowsPerSheet = 16;
  data.endItemFigureId = '';
  data.showModel = false;
  data.showFigureReference = false;
  data.artwork = [];
  data.components = sl3Fixture(31).formData.sl3!.components;
  const sources = await Promise.all([
    { width: 120, height: 300, background: '#2563eb' },
    { width: 300, height: 120, background: '#16a34a' },
    { width: 300, height: 150, background: '#ea580c' },
  ].map(image => sharp({ create: { ...image, channels: 3 } }).jpeg().toBuffer()));
  input.paragraphs = [];
  input.attachments = [];
  for (const [i, component] of data.components.entries()) {
    const id = (i + 1).toString(16).toUpperCase().padStart(32, '0');
    const number = String(i + 1).padStart(2, '0');
    const title = `${['Training adapter', 'Training extension', 'Training tool'][i % 3]} ${number}`;
    Object.assign(component, { nomenclature: `COMPONENT ${number}`, figureId: id, nsn: `5120-99-100-${String(i + 1).padStart(4, '0')}` });
    data.artwork.push({ figureId: id, lettering: 'none', labels: [] });
    input.paragraphs.push({ referenceId: id, text: title, figure: { fileId: id, portionMarking: 'U' } });
    input.attachments.push({ id, name: `synthetic-image-${number}.jpg`, mimeType: 'image/jpeg', dataBase64: sources[i % 3].toString('base64') });
  }
  input.out = `dense-sl3-${orientation}.pdf`;
  return input;
}
