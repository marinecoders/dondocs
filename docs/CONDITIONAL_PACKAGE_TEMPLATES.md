# Versioned conditional package templates

Version 2 package templates add a bounded declarative program to the existing editable member blueprints. Version 1 files and placeholder creation keep their original contract. The library can validate, import, export, rename and restore either version. Version 2 creation requires the conditional intake workflow; the placeholder form cannot create it.

A version 2 template has `program.revision`, `questions`, `participantGroups` and `requirements`. It contains no question answers or defaults. Questions declare text, identifier, ISO date, lexical decimal, boolean or single-choice values. Participant groups declare a role and minimum/maximum count. Member blueprints add a unique `key`, optional `when`, optional `repeatGroupId` and qualified scalar `links`. There must be exactly one first, required, unconditional, nonrepeating main document with role `basic-letter`. A configured form can be that main document. Original attachment slots cannot declare field links.

Conditions support `equals`, `answered`, `all`, `any` and `not`. References name declared questions, never executable expressions or object paths. A global question is available in every scope; a grouped question is available only to its own participant instance. Unknown references, invalid comparison types/options and cyclic question visibility are rejected. `all` returns false when any child is false; `any` returns true when any child is true. Otherwise an unresolved child keeps the result unknown. Negating unknown returns unknown.

Fresh intake is separate from the template:

```json
{
  "version": 1,
  "values": { "include_evidence": false },
  "groups": {
    "people": [
      { "id": "person_1", "label": "Training participant", "answers": { "name": "Alex Example" } }
    ]
  }
}
```

The example's question and group IDs must be declared by its program. An unanswered boolean remains absent; explicit false is an answered value. Identifiers and decimals remain strings, preserving leading zeros and precision. Participant IDs, rather than array positions, determine answer scope. Evaluation owns its returned copy and never reads or writes editor, package or template storage.

Hidden values remain available for inspection and produce inactive-answer warnings. They cannot decide another condition, including an `answered` condition. Invalid visible values produce issues and cannot decide branches. Required visible questions and participant counts produce explicit issues when incomplete. Missing controlling answers leave dependent visibility unknown. There is no guessing, coercion, truncation or automatic source adoption.

Every link must name an available supported native field in the exact captured blueprint. Configured definitions and page checksums must match. All choice options must fit the target's declared options. Linked fields start empty or unanswered; false is not an empty boolean. Version 2 rejects placeholder tokens in declarations and native content, including inactive content. Printed signature names remain blank for deliberate entry in the native editor. Field links cannot write signatures or approval authority. Static document narrative remains native starter text.

Limits are 100 question definitions, 10 participant groups, 20 people per group, 100 people total, 200 question instances/retained answers, 100 member blueprints, 100 requirements, 500 field-link declarations and 50 options per choice. Each condition permits 64 nodes, 8 levels and 20 children; a complete program and its member conditions permit 2,048 nodes. Programs and intake answers each have a 256 KB limit. Existing 12 MB template, 40 MB library and pinned native resource limits still apply. Overflow is rejected rather than truncated.

Template transfer reviews inspect every declaration, condition literal, question option, member rule and link target, including branches that no current action selects. Native retained text and figures use the existing template review. Version 2 transfer also inspects readable text from every pinned PDF background, including inactive branches; unreadable or image-only pages still require manual inspection. Complete workspace recovery preserves versioned declarations and exact blueprint/page bytes; it does not create answers or case participants.

The pure contracts are in `packageTemplateProgram.ts` and `packageTemplateSchema.ts`. `evaluatePackageTemplateProgram`/`validatePackageTemplateAnswers` return owned answers, scoped question visibility, typed-answer issues and readiness. `evaluatePackageTemplateCondition` evaluates one declared rule for an optional `{groupId, participantId}`. `validatePackageTemplate` additionally verifies native drafts, field compatibility and exact template resources without publishing them.
