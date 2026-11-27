"""Append field values and printable appearances to a verified, partially signed AcroForm."""
import json
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject
from pypdf.generic._appearance_stream import TextStreamAppearance
from pyhanko.pdf_utils import generic
from pyhanko.sign import fields

from official_pdf import OfficialReader, OfficialRevisionWriter, inspect_revision, official_profile

MAX_ANSWERS = 64 * 1024
TEMPLATES = Path(__file__).resolve().parents[2] / "public/templates"


def available_fields(data, context):
    profile = official_profile(data)
    if profile["format"] != "acroform" or not profile.get("definitionSha256"):
        raise ValueError("This form edition does not support signed field edits.")
    reader = OfficialReader(BytesIO(data), strict=False)
    _, slots = inspect_revision(data, context, reader=reader)
    signed = {slot["name"] for slot in slots if slot["signed"]}
    if not signed or any(slot["signed"] and not slot["trusted"] for slot in slots):
        raise ValueError("Verify the existing signatures before editing this form.")
    signatures = reader.embedded_signatures
    definition = json.loads((TEMPLATES / profile["directory"] / "form.json").read_text())
    canonical = json.dumps(definition, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    if sha256(canonical).hexdigest() != profile["definitionSha256"]:
        raise ValueError("The form definition no longer matches this edition.")
    # Only expose catalogued, terminal native fields. Composite and calculated fields stay untouched.
    refs = {str(ref.get_object()["/T"]): ref for ref in reader.root["/AcroForm"]["/Fields"] if "/T" in ref.get_object()}
    result = {}
    for key, spec in definition["fields"].items():
        names = spec.get("sourceIds", [])
        if len(names) != 1 or names[0] not in refs:
            continue
        name = names[0]
        ref = refs[name]
        field = ref.get_object()
        if any(sig.docmdp_level == fields.MDPPerm.NO_CHANGES or
               sig.fieldmdp and sig.fieldmdp.is_locked(name) for sig in signatures):
            continue
        if int(field.get("/Ff", 0)) & 1 or field.get("/Subtype") != "/Widget" or "/Kids" in field:
            continue
        native_type = field.get("/FT")
        if native_type not in ("/Ch", "/Tx", "/Btn") or native_type == "/Btn" and spec["kind"] != "boolean":
            continue
        val = str(field["/V"]) if "/V" in field else ""
        options = [{"value": o["id"], "label": o["label"]} for o in spec.get("options", [])]
        if native_type == "/Ch":
            for option in field["/Opt"]:
                native = option.get_object()
                export = str(native[0] if isinstance(native, generic.ArrayObject) else native)
                if not export.strip() and all(o["value"] != export for o in options):
                    options.insert(0, {"value": export, "label": "No selection"})
                    break
        result[key] = (ref, {"id": key, "label": spec["label"], "kind": spec["kind"],
                             "value": val not in ("", "/Off") if native_type == "/Btn" else val,
                             "options": options, "multiline": bool(spec.get("multiline"))})
    return result, signed


def apply_field_edits(data, answers, context):
    available, previous = available_fields(data, context)
    if not isinstance(answers, dict) or not answers or len(answers) > 128:
        raise ValueError("Select the fields to update.")
    writer = OfficialRevisionWriter(BytesIO(data), strict=False)
    original = PdfReader(BytesIO(data))
    if writer.security_handler:
        writer.encrypt("")
        original.decrypt("")
    layout = PdfWriter(original, incremental=True)
    acro = layout.root_object["/AcroForm"]
    pages = {ref.idnum: page for page in layout.pages for ref in page.get("/Annots", [])}
    name = generic.pdf_name
    for key, value in answers.items():
        if key not in available:
            raise ValueError("A selected field is locked or unavailable.")
        ref, spec = available[key]
        writer_ref = generic.Reference(ref.idnum, ref.generation, writer)
        target = writer.get_object(writer_ref)
        if target["/FT"] == "/Btn":
            if type(value) is not bool:
                raise ValueError("Choose a checkbox value.")
            states = [s for s in target["/AP"]["/N"] if s != "/Off"]
            if len(states) != 1:
                raise ValueError("This checkbox has no unique selected appearance.")
            target[name("/V")] = target[name("/AS")] = name(states[0] if value else "/Off")
        else:
            if not isinstance(value, str) or len(value) > min(16000, int(target.get("/MaxLen") or 16000)):
                raise ValueError("The value exceeds the field limit.")
            labels = {o["value"]: o["label"] for o in spec["options"]}
            if target["/FT"] == "/Ch" and value not in labels:
                raise ValueError("Choose a listed value.")
            # Generate the appearance against the original resource IDs. Only the new appearance
            # and selected widget's answer enter the incremental writer.
            widget = layout.get_object(ref.idnum)
            widget[NameObject("/V")] = TextStringObject(labels.get(value, value) if value.strip() else "")
            appearance = TextStreamAppearance.from_text_annotation(layout, pages[ref.idnum], False, acro, widget, widget)
            raw = BytesIO()
            appearance.write_to_stream(raw)
            raw.seek(0)
            stream = generic.read_object(raw, ref.reference)
            target[name("/AP")] = generic.DictionaryObject({name("/N"): writer.add_object(stream)})
            target[name("/V")] = generic.pdf_string(value)
            if target["/FT"] == "/Ch" and "/I" in target:
                options = [str(o[0] if isinstance(o, generic.ArrayObject) else o)
                           for o in target["/Opt"]]
                if value not in options:
                    raise ValueError("Choose a listed value.")
                target[name("/I")] = generic.ArrayObject([generic.NumberObject(options.index(value))])
        writer.mark_update(writer_ref)
    out = BytesIO()
    writer.write(out)
    edited = out.getvalue()
    _, after = inspect_revision(edited, context)
    if not edited.startswith(data) or previous != {s["name"] for s in after if s["signed"] and s["trusted"]}:
        raise ValueError("The saved fields did not preserve all verified signatures.")
    return edited
