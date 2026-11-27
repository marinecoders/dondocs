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
from pyhanko.sign.diff_analysis.form_rules_api import FormUpdatingRule
from pyhanko.sign.diff_analysis.rules.form_field_rules import GenericFieldModificationRule, VALUE_UPDATE_KEYS
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
        # The UPB embeds plaintext CMS in the encrypted catalog. A generic
        # dictionary comparison attempts to decrypt that CMS. Require both
        # revisions to resolve to the exact same on-disk catalog object.
        xrefs = old.reader.xrefs
        before = xrefs.get_historical_ref(old.root_ref, old.revision)
        after = xrefs.get_historical_ref(new.root_ref, new.revision)
        if new.root_ref != old.root_ref or not isinstance(before, int) or before != after:
            raise SuspiciousModification("The official signed catalog changed.")
        return ()


class ChoiceIndexRule(GenericFieldModificationRule):
    """A single-select widget may store its selected option twice, in /V and /I."""

    def compare_fields(self, spec):
        old, new = spec.old_field, spec.new_field
        if old is not None and new is not None and old.get("/I") != new.get("/I"):
            indices = new.get("/I")
            if (new.get("/FT") != "/Ch" or not isinstance(indices, generic.ArrayObject)
                    or len(indices) != 1 or not isinstance(indices[0], generic.NumberObject)
                    or "/Opt" not in new or not 0 <= indices[0] < len(new["/Opt"])):
                raise SuspiciousModification("Invalid changed choice index.")
            option = new["/Opt"][indices[0]].get_object()
            export = option[0] if isinstance(option, generic.ArrayObject) else option
            if "/V" not in new or new["/V"] != export or ("/V" in old and old["/V"] == new["/V"]):
                raise SuspiciousModification("The changed choice index disagrees with the selected value.")
        return super().compare_fields(spec)


ACROFORM_FIELDS = FormUpdatingRule([
    ChoiceIndexRule(value_update_keys=VALUE_UPDATE_KEYS | {"/I"})
    if type(rule) is GenericFieldModificationRule else rule
    for rule in DEFAULT_DIFF_POLICY.form_rule.field_rules
])


class ChangedFormObjects:
    def apply(self, old, new):
        # The default appearance rules emit candidates for unchanged widgets as
        # well. Only whitelist updates that actually have a new xref location.
        xrefs = old.reader.xrefs
        for level, update in ACROFORM_FIELDS.apply(old, new):
            ref = update.updated_ref
            before = xrefs.get_historical_ref(ref, old.revision)
            after = xrefs.get_historical_ref(ref, new.revision)
            if isinstance(before, int) and before == after:
                continue
            yield level, update


UPB_DIFF = StandardDiffPolicy(
    [ImmutableCatalogRule() if isinstance(rule, CatalogModificationRule) else rule
     for rule in DEFAULT_DIFF_POLICY.global_rules],
    ChangedFormObjects(),
)


ACROFORM_DIFF = StandardDiffPolicy(DEFAULT_DIFF_POLICY.global_rules, ChangedFormObjects())


def revision_policy(profile):
    if profile["formId"] == "navmc10132":
        return UPB_DIFF
    return ACROFORM_DIFF if profile["format"] == "acroform" else DEFAULT_DIFF_POLICY


def official_profile(data):
    for profile in EDITIONS:
        if profile.get("nativeSigning") is False:
            continue
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


def inspect_revision(data, context, *, reader=None):
    profile = official_profile(data)
    edition = profile["label"]
    reader = reader or OfficialReader(BytesIO(data), strict=False)
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
        rect = widget["/Rect"] if ref else SLOTS[name]
        result.append({
            "width": abs(float(rect[2]) - float(rect[0])),
            "height": abs(float(rect[3]) - float(rect[1])),
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


def check_signature_order(profile, name, before):
    verified = {slot["name"] for slot in before if slot["signed"] and slot["trusted"]}
    required = profile.get("priorSignatures", {}).get(name, [])
    missing = [field for field in required if field not in verified]
    if missing:
        raise ValueError("Sign first: " + ", ".join(missing) + ".")


def sign_revision(data, name, signer, context, style=None, finalize=False):
    edition, before = inspect_revision(data, context)
    slot = next((item for item in before if item["name"] == name), None)
    if not slot or slot["signed"] or slot["locked"]:
        raise ValueError("This signature field is unavailable or locked.")
    prior = {item["name"] for item in before if item["signed"]}
    if any(item["signed"] and not item["trusted"] for item in before):
        raise ValueError("Verify the earlier signer's certificate chain before countersigning.")
    check_signature_order(official_profile(data), name, before)
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
    profile = official_profile(data)
    check_signature_order(profile, next(iter(additions)), before)
    policy = revision_policy(profile)
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
