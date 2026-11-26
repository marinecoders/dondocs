"""Inspect and incrementally sign qualified official form revisions in memory."""
import asyncio
import json
from hashlib import sha256
from io import BytesIO
from pathlib import Path

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils import generic
from pyhanko.pdf_utils.reader import PdfFileReader, HistoricalResolver
from pyhanko.sign import fields, signers
from pyhanko.sign.diff_analysis import DEFAULT_DIFF_POLICY, StandardDiffPolicy, SuspiciousModification
from pyhanko.sign.diff_analysis.rules.file_structure_rules import CatalogModificationRule
from pyhanko.sign.validation import async_validate_pdf_signature
from pyhanko.sign.validation.status import SignatureCoverageLevel

from page11 import SLOTS, add_signature_slots, replaced_xfa_print_page, xfa_fingerprints

EDITIONS = json.loads((Path(__file__).resolve().parents[2] / "src/data/officialPdfEditions.json").read_text())
PAGE11_LABELS = dict(zip(SLOTS, ("Article 137, left", "Survivor Benefit Plan", "Article 137, center")))


def materialize(value):
    """Compare encrypted direct widget metadata by PDF value, preserving indirect references."""
    if isinstance(value, generic.DecryptedObjectProxy):
        return materialize(value.decrypted)
    if isinstance(value, generic.ArrayObject):
        return generic.ArrayObject(materialize(item) for item in value)
    if isinstance(value, generic.DictionaryObject) and not isinstance(value, generic.StreamObject):
        return generic.DictionaryObject({key: materialize(item) for key, item in value.items()})
    return value


class WidgetResolver(HistoricalResolver):
    def get_object(self, ref, *args, **kwargs):
        value = super().get_object(ref, *args, **kwargs)
        if isinstance(value, generic.DictionaryObject) and "/XFA" in value:
            value[generic.pdf_name("/XFA")] = materialize(value.raw_get("/XFA"))
        if isinstance(value, generic.DictionaryObject) and value.get("/Subtype") == "/Widget":
            for key in tuple(value):
                if key != "/V" or value.get("/FT") != "/Sig":
                    value[generic.pdf_name(key)] = materialize(value.raw_get(key))
        return value


class OfficialReader(PdfFileReader):
    def get_historical_resolver(self, revision):
        if revision not in self._historical_resolver_cache:
            self._historical_resolver_cache[revision] = WidgetResolver(self, revision)
        return self._historical_resolver_cache[revision]


class ImmutableCatalogRule(CatalogModificationRule):
    def apply_qualified(self, old, new):
        # These official forms embed plaintext CMS in the encrypted catalog. A generic
        # dictionary comparison attempts to decrypt that CMS. Require both
        # revisions to resolve to the exact same on-disk catalog object.
        xrefs = old.reader.xrefs
        before = xrefs.get_historical_ref(old.root_ref, old.revision)
        after = xrefs.get_historical_ref(new.root_ref, new.revision)
        if new.root_ref != old.root_ref or not isinstance(before, int) or before != after:
            raise SuspiciousModification("The official signed catalog changed.")
        return ()


class ChangedFormObjects:
    def apply(self, old, new):
        # The default appearance rules emit candidates for unchanged widgets as
        # well. Only whitelist updates that actually have a new xref location.
        xrefs = old.reader.xrefs
        for level, update in DEFAULT_DIFF_POLICY.form_rule.apply(old, new):
            ref = update.updated_ref
            before = xrefs.get_historical_ref(ref, old.revision)
            after = xrefs.get_historical_ref(ref, new.revision)
            if isinstance(before, int) and before == after:
                continue
            yield level, update


IMMUTABLE_CATALOG_DIFF = StandardDiffPolicy(
    [ImmutableCatalogRule() if isinstance(rule, CatalogModificationRule) else rule
     for rule in DEFAULT_DIFF_POLICY.global_rules],
    ChangedFormObjects(),
)


ACROFORM_DIFF = StandardDiffPolicy(DEFAULT_DIFF_POLICY.global_rules, ChangedFormObjects())


def revision_policy(profile):
    if profile["formId"] in ("navmc10132", "dd0368"):
        return IMMUTABLE_CATALOG_DIFF
    return ACROFORM_DIFF if profile["format"] == "acroform" else DEFAULT_DIFF_POLICY


def official_profile(data):
    for profile in EDITIONS:
        length = profile["length"]
        if len(data) >= length and sha256(memoryview(data)[:length]).hexdigest() == profile["sha256"]:
            return profile
    raise ValueError("Choose an original PDF revision from a supported official form edition.")


def slot_definition(ref):
    widget = ref.get_object()
    lock = widget.get("/Lock")
    lock = lock.get_object() if lock is not None else {}
    return (tuple(float(x) for x in widget["/Rect"]), str(lock.get("/Action", "")),
            tuple(str(entry.get_object()) for entry in lock.get("/Fields", [])))


def check_slots(profile, data, slots):
    if profile["format"] == "xfa":
        expected = set(SLOTS)
        valid = all(ref is None or slot_definition(ref)[0] == SLOTS.get(name) for name, _, ref in slots)
    else:
        original = OfficialReader(BytesIO(data[:profile["length"]]), strict=False)
        if original.security_handler:
            original.decrypt("")
        definitions = {name: slot_definition(ref) for name, _, ref in fields.enumerate_sig_fields(original)}
        expected = set(definitions)
        valid = all(slot_definition(ref) == definitions.get(name) for name, _, ref in slots)
    if not valid or len(slots) != len(expected) or {name for name, _, _ in slots} != expected:
        raise ValueError("The signature fields differ from the maintained official edition.")


def inspect_revision(data, context):
    profile = official_profile(data)
    edition = profile["label"]
    reader = OfficialReader(BytesIO(data), strict=False)
    if reader.security_handler:
        reader.decrypt("")
    signatures = reader.embedded_signatures
    checked = {}
    unapproved_revisions = []
    for sig in signatures:
        policy = sig.fieldmdp
        if policy and policy.fields:
            # pyHanko retains the reader's PDF array in the policy. Normalize a
            # detached policy so historical signature dictionaries stay intact.
            sig._fieldmdp = fields.FieldMDPSpec(policy.action, [str(item.get_object()) for item in policy.fields])
        result = asyncio.run(async_validate_pdf_signature(sig, signer_validation_context=context,
            diff_policy=revision_policy(profile)))
        if not (result.intact and result.valid
                and result.coverage in (SignatureCoverageLevel.ENTIRE_FILE, SignatureCoverageLevel.ENTIRE_REVISION)):
            raise ValueError("A PDF signature is damaged or does not cover its entire signed revision.")
        if result.docmdp_ok is not True:
            unapproved_revisions.append(sig.signed_revision)
        checked[sig.field_name] = bool(result.trusted)
    if unapproved_revisions:
        if (len(signatures) > 1 and all(checked.values())
                and signatures[-1].evaluate_signature_coverage() == SignatureCoverageLevel.ENTIRE_FILE):
            reason = "DonDocs could not verify that the later changes were permitted."
            if edition == "Page 11" and any(replaced_xfa_print_page(reader, rev) for rev in unapproved_revisions):
                reason = "The printable Page 11 was rewritten after signing. Its content could not be verified."
            raise ValueError(f"The signatures verify and their certificate chains are trusted. {reason}")
        raise ValueError("Changes made after signing could not be verified as permitted.")
    slots = list(fields.enumerate_sig_fields(reader))
    if edition == "Page 11" and not slots and not signatures:
        slots = [(name, None, None) for name in SLOTS]
    check_slots(profile, data, slots)
    result = []
    for name, value, ref in slots:
        locked = any(sig.docmdp_level == fields.MDPPerm.NO_CHANGES
                     or sig.fieldmdp and sig.fieldmdp.is_locked(name) for sig in signatures)
        widget = ref.get_object() if ref else {}
        locked = bool(locked or int(widget.get("/Ff", 0)) & 1)
        lock = widget["/Lock"] if "/Lock" in widget else {}
        result.append({
            "name": name, "label": PAGE11_LABELS.get(name, str(widget.get("/TU", name))),
            "signed": value is not None, "locked": locked,
            "trusted": checked.get(name), "lockAction": str(lock.get("/Action", "")).lstrip("/"),
            "lockFields": [str(item.get_object()) for item in lock.get("/Fields", [])],
        })
    return edition, result


class OfficialRevisionWriter(IncrementalPdfFileWriter):
    def _update_meta(self):
        # Preserve publisher metadata. Regenerating the UPB catalog also rewrites
        # its direct Adobe usage-rights signature, which must remain byte-exact.
        pass


def sign_revision(data, name, signer, context, style=None, finalize=False):
    edition, before = inspect_revision(data, context)
    slot = next((item for item in before if item["name"] == name), None)
    if not slot or slot["signed"] or slot["locked"]:
        raise ValueError("This signature field is unavailable or locked.")
    prior = {item["name"] for item in before if item["signed"]}
    if any(item["signed"] and not item["trusted"] for item in before):
        raise ValueError("Verify the earlier signer's certificate chain before countersigning.")
    if finalize and edition != "Page 11":
        raise ValueError("This edition supplies its own signature locks.")
    if finalize and prior:
        raise ValueError("A document-wide certification lock must be set on the first signature.")
    writer = OfficialRevisionWriter(BytesIO(data), strict=False)
    if writer.security_handler:
        writer.encrypt("")
    packets = xfa_fingerprints(writer)
    if edition == "Page 11" and not list(fields.enumerate_sig_fields(writer)):
        add_signature_slots(writer)
    meta = signers.PdfSignatureMetadata(field_name=name, md_algorithm="sha256", certify=finalize,
                                        docmdp_permissions=fields.MDPPerm.NO_CHANGES if finalize else fields.MDPPerm.FILL_FORMS)
    output = BytesIO()
    signers.PdfSigner(meta, signer, stamp_style=style).sign_pdf(writer, existing_fields_only=True, output=output)
    signed = output.getvalue()
    if not signed.startswith(data):
        raise ValueError("The earlier PDF revision changed.")
    _, after = inspect_revision(signed, context)
    if {item["name"] for item in after if item["signed"]} != prior | {name}:
        raise ValueError("The returned PDF does not contain the expected signatures.")
    reader = PdfFileReader(BytesIO(signed), strict=False)
    if reader.security_handler:
        reader.decrypt("")
    sig = next(s for s in reader.embedded_signatures if s.field_name == name)
    if (not next(i["trusted"] for i in after if i["name"] == name)
        or sig.signer_cert.dump() != signer.signing_cert.dump()
        or sig.evaluate_signature_coverage() != SignatureCoverageLevel.ENTIRE_FILE
        or xfa_fingerprints(reader) != packets):
        raise ValueError("The signed PDF did not pass certificate, revision and content checks.")
    return signed


def inspect_return(data, base_length, base_hash, context):
    if not 0 < base_length < len(data) or sha256(data[:base_length]).hexdigest() != base_hash:
        raise ValueError("The return does not extend this exact saved file.")
    edition, before = inspect_revision(data[:base_length], context)
    _, after = inspect_revision(data, context)
    old_fields = {field["name"]: field for field in before}
    additions = {field["name"] for field in after if field["signed"] and not old_fields.get(field["name"], {}).get("signed")}
    if (len(additions) != 1 or next(iter(additions)) not in old_fields
        or old_fields[next(iter(additions))]["locked"] or any(field["signed"] and not field["trusted"] for field in after)):
        raise ValueError("Return one new, trusted signature in an unlocked field.")
    base = OfficialReader(BytesIO(data[:base_length]), strict=False)
    reader = OfficialReader(BytesIO(data), strict=False)
    if reader.security_handler:
        reader.decrypt("")
    policy = revision_policy(official_profile(data))
    result = policy.review_file(reader, base.total_revisions - 1)
    if isinstance(result, Exception) or result.changed_form_fields != additions:
        raise ValueError("The return changes more than the selected signature.")
    from pyhanko.sign.diff_analysis import ModificationLevel
    if result.modification_level != ModificationLevel.FORM_FILLING:
        raise ValueError("The returned revision changed document content.")
    last = next(s for s in reader.embedded_signatures if s.field_name in additions)
    if last.evaluate_signature_coverage() != SignatureCoverageLevel.ENTIRE_FILE:
        raise ValueError("The new signature must cover the complete returned file.")
    return edition, after
