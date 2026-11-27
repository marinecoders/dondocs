"""Build pinned fillable editions on top of the immutable JAGMAN extracts.

Run with Python, pypdf 6.8 and reportlab 4.4 from the repository root.
Package recipes reference catalog IDs. Store each publisher original at
public/templates/jagman/<appendix>/<source edition>/original.pdf. Store
editable revisions in numbered subdirectories of that edition. Retain the
previous editions so existing forms and signed returns can still be identified.

The six originals are extracts of JAGINST 5800.7G CH-2, PDF pages 185–196
(A-1-d through A-1-h) and 210–213 (A-1-o). Source:
https://www.jag.navy.mil/documents/8962/Encl_JAGINST_5800.7G_CH-2_Under_Revision.pdf
Map coordinates are PDF points from the top left of the published page.
"""
import hashlib
import json
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, RectangleObject, TextStringObject
from reportlab.lib.colors import black, white
from reportlab.pdfgen.canvas import Canvas

from maps import FORMS

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / "public/templates"
SOURCE_EDITION = "5800.7G-CH2"
FIELD_REVISION = "1"
EDITION = f"{SOURCE_EDITION}.{FIELD_REVISION}"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def signed_answers(code, signer, fields, groups):
    """Lock answers attested at this stage, leaving later signature slots available."""
    answers = [key for key, field in fields.items() if field["kind"] != "signature"]
    if code == "d" and signer.startswith(("Counsel_", "Consultation_")):
        notice = groups[0]["fields"]
        choices = ["military_counsel", "civilian_counsel", "waived", "unavailable"]
        if signer.startswith("Consultation_"):
            choices += ["consulted", "lawyer", "consultation_date"]
        return notice + choices
    if code == "o" and signer != "Statement_suspect":
        return [key for group in groups[:2] for key in group["fields"]]
    return answers


def build(spec):
    code, title, source_hash, sections = spec
    directory = f"jagman/a-1-{code}/{SOURCE_EDITION}/{FIELD_REVISION}"
    form_id = f"jagman_a1{code}"
    source = (TEMPLATES / directory).parent / "original.pdf"
    if digest(source.read_bytes()) != source_hash:
        raise ValueError(f"Requalify placements against {source.name}")
    writer = PdfWriter(str(source), incremental=True)
    overlay = BytesIO()
    canvas = Canvas(overlay, pagesize=(612, 792), invariant=1)
    fields, placements, groups = {}, [], []
    on_page = [[] for _ in writer.pages]
    for section_id, heading, entries in sections:
        groups.append(dict(id=section_id, title=heading, fields=[entry[0] for entry in entries]))
        for key, label, kind, required, boxes in entries:
            field = dict(kind=kind, label=label, sourceIds=[key])
            if required:
                field["requiredAt"] = "export"
            if kind == "singleChoice":
                field["options"] = [dict(id=b[5], label=b[6]) for b in boxes]
            fields[key] = field
            for page, left, bottom, width, height, *option in boxes:
                on_page[page-1].append((key, field, left, bottom, width, height, option))
                box = dict(left=left, top=792-bottom+height, width=width, height=height)
                mark = kind in ("singleChoice", "boolean")
                placements.append(dict(fieldId=key, page=page, box=box, appearance="mark" if mark else "text",
                                       overflow="shrink", **({"optionId": option[0]} if option else {})))
    signatures = []
    for i, items in enumerate(on_page):
        for key, field, x, bottom, width, height, option in items:
            y = 792-bottom
            args = dict(name=key, tooltip=field["label"], x=x, y=y, borderWidth=0, forceBorder=False,
                        textColor=black, fillColor=white, borderColor=white)
            kind = field["kind"]
            if kind == "signature":
                signatures.append((i, key, field["label"], [x,y,x+width,y+height]))
            elif kind == "singleChoice":
                canvas.acroForm.radio(**args, size=height, value=option[0], selected=False)
            elif kind == "boolean":
                canvas.acroForm.checkbox(**args, size=height)
            else:
                multiline = height >= 24
                if multiline:
                    field["multiline"] = True
                canvas.acroForm.textfield(**args, width=width, height=height, fontSize=9,
                                          fieldFlags="multiline" if multiline else "", maxlen=0)
        canvas.showPage()
    canvas.save()
    source_form = PdfReader(BytesIO(overlay.getvalue()))
    acro = source_form.root_object["/AcroForm"].clone(writer, ignore_fields=["/P"])
    acro[NameObject("/SigFlags")] = NumberObject(3)
    writer.root_object[NameObject("/AcroForm")] = acro.indirect_reference
    for i, page in enumerate(source_form.pages):
        target = writer.pages[i]
        annots = target.setdefault(NameObject("/Annots"), ArrayObject())
        for ref in page.get("/Annots", []):
            widget = ref.get_object().clone(writer, ignore_fields=["/P"])
            widget[NameObject("/P")] = target.indirect_reference
            annots.append(widget.indirect_reference)
    for i,key,label,rect in signatures:
        target = writer.pages[i]
        widget = DictionaryObject({NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/FT"): NameObject("/Sig"), NameObject("/F"): NumberObject(4), NameObject("/T"): TextStringObject(key),
                NameObject("/TU"): TextStringObject(label), NameObject("/P"): target.indirect_reference, NameObject("/Rect"): RectangleObject(rect)})
        widget[NameObject("/Lock")] = DictionaryObject({
            NameObject("/Type"): NameObject("/SigFieldLock"),
            NameObject("/Action"): NameObject("/Include"),
            NameObject("/Fields"): ArrayObject([TextStringObject(name) for name in signed_answers(code, key, fields, groups)]),
        })
        ref = writer._add_object(widget)
        target["/Annots"].append(ref)
        acro["/Fields"].append(ref)
    dest = TEMPLATES / directory
    dest.mkdir(parents=True, exist_ok=True)
    writer.write(dest / "fillable.pdf")
    pdf = (dest / "fillable.pdf").read_bytes()
    assert pdf.startswith(source.read_bytes())
    label = f"JAGMAN A-1-{code} - {title}"
    pages = [dict(file="fillable.pdf", width=612, height=792, sha256=digest(pdf)) for _ in writer.pages]
    definition = dict(schemaVersion=2, formId=form_id, label=label, directory=directory,
                      definitionRevision=EDITION, nativePdfEdition=EDITION, templateRevision=digest(pdf),
                      pages=pages, fields=fields, sections=groups, placements=placements, rowGroups={})
    save_json(dest / "form.json", definition)
    canonical = json.dumps(definition, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return dict(formId=form_id, edition=EDITION, label=title, format="acroform", directory=directory,
                file="fillable.pdf", length=len(pdf), sha256=digest(pdf), definitionSha256=digest(canonical),
                pageSizes=[[612,792] for _ in pages]), dict(id=form_id, name=label, directory=directory,
                definitionRevision=EDITION, status="published", config=True, category="Legal & Discipline",
                keywords=["NJP", "JAGMAN"], pages=["fillable.pdf"])


if __name__ == "__main__":
    editions_path = ROOT / "src/data/officialPdfEditions.json"
    index_path = TEMPLATES / "index.json"
    editions = json.loads(editions_path.read_text())
    index = json.loads(index_path.read_text())
    for form in FORMS:
        edition, row = build(form)
        # Keep historical editions available to previously saved and signed forms.
        index_of_form = next((i for i, item in enumerate(editions) if item["formId"] == edition["formId"]), len(editions))
        editions = [item for item in editions if (item["formId"], item["edition"]) != (edition["formId"], edition["edition"])]
        editions.insert(index_of_form, edition)
        index["templates"] = [item for item in index["templates"] if item["id"] != row["id"]] + [row]
    save_json(editions_path, editions)
    save_json(index_path, index)
