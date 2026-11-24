#!/usr/bin/env python3
"""Extract the pinned bundled manual with Poppler; never download or rewrite it."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SECNAV_SECTIONS = [
    ('front', 'Front matter', 1), ('1', 'Correspondence Management', 15),
    ('2', 'Correspondence Standards and Procedures', 17), ('3', 'Electronic Records', 31),
    ('4', 'Electronic Mail', 33), ('5', 'Facsimile Transmission Services', 37),
    ('6', 'Postal Standards', 39), ('7', 'Correspondence Format', 48),
    ('8', 'Multiple-Address Letter', 74), ('9', 'Endorsements', 80),
    ('10', 'Memorandums', 86), ('11', 'Business Letters', 96),
    ('12', 'Executive Correspondence', 106), ('A', 'Military Models of Address', 136),
    ('B', 'Civilian Models of Address', 139), ('C', 'Stationery Requirements', 150),
    ('D', 'Forms and Envelopes', 153), ('E', 'Index', 154),
]


MCO_SECTIONS = [
    ('front', 'Order and administrative changes', 1),
    ('13', 'Marine Corps correspondence', 17),
    ('A', 'Abbreviations for HQMC staff agencies', 76),
    ('B', 'Special correspondence assignments', 78),
]
MCO_SHA256 = 'd7bae042e7cdee4e4d5e05c1b66761c582a83916865a6f754b58c26de5a49102'


def build_mco(check):
    directory = f'references/mco-5216-20b/{MCO_SHA256}'
    pdf = ROOT / 'public' / directory / 'manual.pdf'
    reference = {'title': 'Marine Corps Supplement to the Department of the Navy Correspondence Manual',
                 'sha256': MCO_SHA256, 'pages': 81,
                 'sourceUrl': 'https://www.marines.mil/News/Publications/MCPEL/Electronic-Library-Display/Article/2795618/mco-521620b-wadmin-ch-4/'}
    build_resource(pdf, reference, directory, 'mco-5216-20b-ch4', 'MCO 5216.20B',
                   '10 March 2016, Administrative Change 4 (29 September 2025)',
                   MCO_SECTIONS, 'mcoCorrespondenceManualSource.json', check)


def build_secnav(check):
    references = json.loads((ROOT / 'docs/reference-sources.json').read_text())['references']
    reference = next(item for item in references if item['file'] == 'references/5216.5  CH-1.pdf')
    source = ROOT / 'docs' / reference['file']
    build_resource(source, reference, f"references/secnav-m-5216-5/{reference['sha256']}",
                   'secnav-m-5216-5-ch1', 'SECNAV M-5216.5', 'June 2015, Change 1 (16 May 2018)',
                   SECNAV_SECTIONS, 'correspondenceManualSource.json', check)


def build_resource(source, reference, directory, identifier, short_title, edition, sections, metadata_file, check):
    pdf = source.read_bytes()
    digest = hashlib.sha256(pdf).hexdigest()
    if digest != reference['sha256']:
        raise ValueError('The source differs from the reviewed reference registry; inspect and update its page map first.')
    extracted = subprocess.check_output(
        ['pdftotext', '-layout', '-enc', 'UTF-8', str(source), '-'], text=True, timeout=30)
    pages = extracted.split('\f')
    if pages.pop().strip() or len(pages) != reference['pages']:
        raise ValueError('Unexpected source page count.')
    records = []
    for i, value in enumerate(pages):
        cleaned = '\n'.join(re.sub(r'[\x00-\x08\x0b\x0e-\x1f]', '', line).rstrip() for line in value.splitlines()).strip()
        labels = re.findall(r'^\s*((?:\d+|[A-E])-\d+)\s*$', cleaned, re.M)
        section = next(s for s in reversed(sections) if i + 1 >= s[2])
        records.append({'number': i + 1, 'label': labels[0] if labels else str(i + 1),
                        'section': section[0], 'text': cleaned})
    data = {'schema': 1, 'sourceSha256': digest,
            'sections': [{'id': sid, 'title': title, 'firstPage': start,
                          'lastPage': sections[i + 1][2] - 1 if i + 1 < len(sections) else len(pages)}
                         for i, (sid, title, start) in enumerate(sections)], 'pages': records}
    text = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    text_digest = hashlib.sha256(text).hexdigest()
    metadata = {'id': identifier, 'title': reference['title'],
                'shortTitle': short_title, 'edition': edition,
                'sourceUrl': reference['sourceUrl'], 'sourceSha256': digest, 'textSha256': text_digest,
                'pdfBytes': len(pdf), 'textBytes': len(text), 'pages': len(pages),
                'pdfPath': f'{directory}/manual.pdf', 'textPath': f'{directory}/text-{text_digest}.json'}
    outputs = {ROOT / 'public' / metadata['pdfPath']: pdf,
               ROOT / 'public' / metadata['textPath']: text,
               ROOT / 'src/data' / metadata_file: (json.dumps(metadata, indent=2) + '\n').encode()}
    for target, content in outputs.items():
        if check:
            if not target.exists() or target.read_bytes() != content:
                raise ValueError(f'Regenerate the manual resource: {target.relative_to(ROOT)}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    print(f'Manual source and extracted text verified: {len(pages)} pages, {len(text)} text bytes.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    check = parser.parse_args().check
    build_secnav(check)
    build_mco(check)
