"""Shared native Page 11 fields and incremental update checks."""

from hashlib import sha256
from pyhanko.pdf_utils import generic
from pyhanko.sign import fields

# Native widget bounds for the pinned May 2014 Page 11 template, in PDF points.
# Index order follows the official XFA field names, not their visual order.
WIDGET_BOXES = (
    (38.518, 585.501, 213.165, 608.513),
    (398.835, 583.703, 573.165, 607.691),
    (218.835, 584.342, 393.165, 609.049),
)
SLOTS = {
    f"form1[0].#subform[0].SignatureField1[{index}]": box
    for index, box in enumerate(WIDGET_BOXES)
}


def xfa_fingerprints(reader):
    if "/XFA" not in reader.root["/AcroForm"]:
        return None
    packets = reader.root["/AcroForm"]["/XFA"]
    if len(packets) % 2:
        raise ValueError("Invalid Page 11 XFA packet list.")
    return tuple(
        (str(packets[i]), sha256(packets[i + 1].data).digest())
        for i in range(0, len(packets), 2)
    )


def add_signature_slots(writer):
    for name, box in SLOTS.items():
        fields.append_signature_field(writer, fields.SigFieldSpec(name, box=box))


def replaced_xfa_print_page(reader, signed_revision):
    """Identify the pinned single-page XFA-to-print rewrite for diagnostics only."""
    old = reader.get_historical_resolver(signed_revision)
    current = reader.get_historical_resolver(reader.total_revisions - 1)
    flag = old.root.get("/NeedsRendering")
    if not isinstance(flag, generic.BooleanObject) or not flag.value or "/NeedsRendering" in current.root:
        return False

    def contents_ref(revision):
        pages = revision.root["/Pages"]
        children = pages["/Kids"]
        if pages["/Count"] == 1 and len(children) == 1:
            page = children[0].get_object()
            if page.get("/Type") == "/Page":
                contents = page.raw_get("/Contents")
                if isinstance(contents, generic.IndirectObject):
                    return contents.reference
        return None

    before, after = contents_ref(old), contents_ref(current)
    if before is None or after is None:
        return False
    xrefs = reader.xrefs
    return ((before.idnum, before.generation) != (after.idnum, after.generation)
            or xrefs.get_historical_ref(before, old.revision) != xrefs.get_historical_ref(after, current.revision))
