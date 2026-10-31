"""Compare the supplied SL-3 forms with fresh synthetic publication exports."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import pdfplumber
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--sources', type=Path, required=True)
parser.add_argument('--exports', type=Path, required=True)
parser.add_argument('--pdftotext', default='pdftotext')
args = parser.parse_args()
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
preface = json.loads((args.exports / 'fixed-preface.json').read_text())
# Join run boundaries, line breaks and punctuation; retain every letter's case.
def normalized(value):
    return re.sub('[^A-Za-z0-9]', '', unicodedata.normalize('NFKC', value))

results = []
for orientation in ['portrait', 'landscape']:
    source = args.sources / f'1. SL-3 {orientation.title()} Template.docx'
    with ZipFile(source) as archive:
        xml = ET.fromstring(archive.read('word/document.xml'))
        source_text = ' '.join(''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in xml.findall('.//w:p', ns))
    path = args.exports / f'complete-{orientation}.pdf'
    text = subprocess.check_output([args.pdftotext, '-layout', str(path), '-'], text=True)
    pages = [page for page in text.split('\f') if page.strip()]
    reader = PdfReader(path)
    captions = []
    with pdfplumber.open(path) as pdf:
        for n, page in enumerate(pdf.pages, 1):
            caption = [w for w in page.extract_words() if w['text'].startswith('Figure')]
            if page.images and n != 1 and caption:
                bottom = page.images[0]['bottom']
                captions.append({'page': n, 'image_bottom': bottom, 'caption_top': caption[0]['top'], 'clearance': caption[0]['top'] - bottom})
        pcn = [c for c in pdf.pages[0].chars if c['top'] > 700]
        cover_style = {'bottom_text_fonts': sorted(set(c['fontname'].split('+')[-1] for c in pcn)), 'bottom_text_sizes': sorted(set(round(c['size'], 3) for c in pcn)), 'pcn_bottom_clearance': round(pdf.pages[0].height - max(c['bottom'] for c in pcn), 3)}
    results.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'pages': len(pages), 'fixed_preface_blocks': len(preface), 'source_preface_matches': [normalized(b['text']) in normalized(source_text) for b in preface], 'output_preface_matches': [normalized(b['text']) in normalized(text) for b in preface], 'footers': [p.strip().splitlines()[-1].strip() for p in pages], 'link_annotations': sum(a.get_object().get('/Subtype') == '/Link' for p in reader.pages for a in p.get('/Annots', [])), 'template_prompts_found': re.findall('INSERT NOMENCLATURE|Select appropriate|END ITEM GRAPHIC GOES HERE|INSTRUCTIONS FOR USING', text, re.I), 'caption_clearance_points': captions, 'covered_categories': {s: s in text for s in ['SUPPLY SYSTEM RESPONSIBILITY ITEMS', 'COLLATERAL MATERIEL', 'USING UNIT RESPONSIBILITY ITEMS']}, 'source_TAMCN_examples_present': all(s in text for s in ['B2565', 'B2483']), 'signature_fields': list((reader.get_fields() or {}).keys()), 'cover_style': cover_style})
(args.exports / 'section-observations.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
if any(not all(r['source_preface_matches'] + r['output_preface_matches']) or r['template_prompts_found'] for r in results):
    raise SystemExit('A fixed-source comparison failed.')
