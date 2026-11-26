"""Build the DonDocs signature sheet used only for package correspondence."""
from pathlib import Path
from io import BytesIO
from hashlib import sha256
import json

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, RectangleObject, TextStringObject
from reportlab.pdfgen.canvas import Canvas

root = Path(__file__).resolve().parents[2]
directory = 'DonDocs correspondence signature'
target = root / 'public/templates' / directory / 'original.pdf'
target.parent.mkdir(exist_ok=True)
stream = BytesIO()
canvas = Canvas(stream, pagesize=(612, 792), invariant=1)
canvas.setTitle('Correspondence signature')
canvas.setFont('Times-Bold', 14)
canvas.drawString(72, 700, 'Correspondence signature')
canvas.setFont('Times-Roman', 12)
canvas.drawString(72, 674, 'The signature below covers the preceding correspondence and this page.')
canvas.drawString(72, 552, 'Signing authority')
canvas.rect(72, 570, 250, 60)
canvas.save()
writer = PdfWriter(clone_from=PdfReader(stream))
page = writer.pages[0]
authority_field = 'Signing_authority'
widget = DictionaryObject({
    NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Widget'),
    NameObject('/FT'): NameObject('/Sig'), NameObject('/T'): TextStringObject(authority_field),
    NameObject('/TU'): TextStringObject('Signing authority'), NameObject('/F'): NumberObject(4),
    NameObject('/Rect'): RectangleObject([72,570,322,630]), NameObject('/P'): page.indirect_reference,
})
ref = writer._add_object(widget)
page[NameObject('/Annots')] = ArrayObject([ref])
writer.root_object[NameObject('/AcroForm')] = writer._add_object(DictionaryObject({
    NameObject('/Fields'): ArrayObject([ref]), NameObject('/SigFlags'): NumberObject(3)}))
writer.write(target)
pdf = target.read_bytes()
p = root / 'src/data/officialPdfEditions.json'
rows = [r for r in json.loads(p.read_text()) if r['formId'] != 'package_correspondence']
rows.append(dict(formId='package_correspondence', edition='1', label='Correspondence signature', format='acroform',
                 directory=directory, file=target.name, length=len(pdf), sha256=sha256(pdf).hexdigest(), pageSizes=[[612,792]], signatureFieldIds={'signing_authority': authority_field}))
p.write_text(json.dumps(rows,indent=2)+'\n')
