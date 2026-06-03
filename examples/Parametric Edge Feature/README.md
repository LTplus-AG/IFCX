# Parametric Edge Feature — Level-3 operand proof (WS4)

A minimal demonstration that, because Brep topology is now **identity-bearing
child nodes**, a Level-3 generative function can take a **named edge as an
operand, referenced by path** — the thing that was impossible when an edge was
an ordinal array index (`Face_0` had no persistent identity across a boolean).

This is the concrete "IFC5 has *appropriate* complexity, not a dumbed-down IFC4"
argument. It is a **proof that the operand resolves**, not a parametrics spec.

## What's here

It is the Hello Brep Cube (explicit Brep, children form) plus one extra layer:
a fillet feature that references edge `Edge_3` of the cube body.

`ifcx.geom.feature.ndjson`:

```json
{ "bsi::ifc::geometry::feature::fillet_edge": {
    "Edge": "</11111111-2222-3333-4444-555555555555/Edge_3>",
    "Radius": 0.05 } }
```

The `Edge` operand is a path reference (`<...>`, USD relationship syntax) to the
**stable authored path** of a real edge node — the edge's identity, not its
position in an array. `index.ifcx` links the feature into the tree as the
element's `EdgeFillet` child.

## Why it matters

- **The operand resolves.** `</…/Edge_3>` resolves to a real, addressable node
  carrying that edge's geometry (`Curve`, `Start`, `End`). A generative function
  or constraint can name it, and re-find it, because it has identity.
- **Graceful degradation.** The cube body still carries explicit Brep + a derived
  display mesh. A viewer with no parametric support renders the cube unchanged;
  the fillet feature is simply inert data it ignores. Parametric behaviour
  happens only where it is supported.
- **It composes the normal way.** The feature is an ordinary layer/opinion over
  the post-composition tree — the same layering model that carries per-face
  materials onto real face nodes. No new composition machinery.

The `bsi::ifc::geometry::feature::*` vocabulary here is **illustrative**, not a
normative schema — it exists to prove the data model supports path operands.

See `docs/geometry-tiers-design.md` (Level 3 — Procedural) and
`docs/geometry-tiers-rework-plan.md` (WS4).
