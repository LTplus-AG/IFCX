# Geometry tiers — rework plan

Reworking the `louistrue-geometry-tiers` branch to follow Thomas's guidance. The
core shift is from **index-addressed topology with flat attribute keys** to
**identity-bearing topology as IFCX children with relative-path references**,
aligned to the bSI Technical Roadmap geometry levels.

Status: **WS1 implemented; schema + design doc frozen.** Both gating questions
settled per recommendations (provenance-based boolean identity;
`bsi::ifc::geometry::procedural::*` vocabulary).

Implementation progress (Brep path is end-to-end green, 98/98 tests, CLI +
viewer build):
- **Done** — TypeSpec + JSON schema (children model, `BrepRef`, `BrepDerivedFrom`,
  `faceName`); design doc; `composition/path.ts` (`GetParent`/`ResolveRelative`);
  `geometry-tiers.ts` authored node-body types (flat `Brep` kept as in-memory
  compile target); `brep-reference.ts`; `brep-assembler.ts`; `brep-writer.ts`;
  `tessellateBrep` faceName; loader de-latenting + subtree assembly;
  AP242 importer → children; viewer per-face material reads the composed face
  node by `faceName`; Hello Brep Cube example regenerated; tests migrated +
  unit tests for the new modules.
- **Done (WS3)** — legacy `Hello Wall/hello-wall.ifcx` migrated off USD
  `basiscurves`/`Directrix`/`Basis` onto `bsi::ifc::geometry::procedural::extruded_area_solid`
  (display mesh + `xformop` placement kept; local schema declared so it
  validates). Variants carry no legacy form; importers/schema already used the
  converged vocabulary.
- **Done (WS3.5)** — Hello Wall Tiered's Brep tier regenerated to children form.
- **Done (WS4)** — `examples/Parametric Edge Feature/`: a Level-3 fillet feature
  references a named edge by path; test proves the operand resolves to a real
  addressable edge node, with explicit-geometry graceful degradation.
- **Done (browser verification)** — served `web/viewer` and loaded every example
  in a real browser (Hello Brep Cube, Parametric Edge Feature, legacy Hello Wall,
  Hello Wall Tiered). This surfaced two bugs the unit tests missed because they
  stop at `loadIndexFile` and never run the viewer's `compose3`/`Validate`:
  1. **Composition recursion** — topology children authored at `body/Edge_n`
     (descendants of the body) sent the composer into infinite recursion: it
     resolved a child value `body/Edge_n` as "compose root `body`, graft subpath
     `Edge_n`", recomposing the parent forever. Fixed in `composition/compose.ts`:
     when a child value is itself a directly-authored node, compose it directly
     (backward-compatible; single-segment and true prototype refs unchanged).
     Guarded by a new composition regression test.
  2. **Schema validity** — per-face `bsi::ifc::material` lacked the schema-required
     `uri`; previously hidden inside a flattened `ifcx::brep::face::n::…` key, it
     is now a first-class attribute on the real face node and is validated. Fixed
     the example data (Hello Brep Cube + Parametric Edge Feature). The cube now
     renders with its six distinct per-face colors through the children model.
- **Remaining** — optional `GeometryLevel` type alias (S3); IFC4 Brep import path
  (importers currently emit procedural, not Brep, so no change needed unless a
  Brep-emitting IFC importer is added); a normative `feature::*` schema if the
  group wants Level-3 operands specced beyond the proof.

---

## 0. The one decision everything hangs on

**Children vs attributes.** The rule we adopt:

- **Identity-bearing topology** — faces, edges, vertices, loops, shells, regions
  — becomes **authored child nodes** under the Brep, referenced by **relative
  path** (`<../Edge_3>`), never by ordinal index.
- **Derived / cache-only data** — tessellation, source hash, tolerance,
  face-group ranges, boolean provenance — stays **attributes**, because it has
  no identity worth referencing and is cheap to drop and recompute.
- **Geometric carriers** — the curve of an edge, the surface of a face — are
  **inline attributes** on their owning primitive, not separate addressable
  nodes. They carry no identity in our model (a face *is* its surface), and
  inlining keeps each primitive self-describing. (Sub-decision S1 below; this is
  the recommended reading, flagged for confirmation.)

Everything below is the consequence of applying that rule consistently.

---

## 1. Architecture: two layers, only one of them changes

The single most important scoping decision. The flat-indexed `Brep` is **not**
deleted — it is **demoted from an authored wire format to a private in-memory
compile target.**

```
AUTHORED form (changes)            COMPILED form (unchanged consumer)
-----------------------            ---------------------------------
Brep subtree of child nodes        flat-indexed Brep { vertices[], edges[], ... }
with <../rel> reference attrs  ──▶  produced by a new "Brep assembler"
(in index.ifcx + ndjson tables)    consumed as-is by tessellate.ts / brep-validate.ts
```

- **Authored layer** (what the file contains, what changes in WS1/WS5): topology
  primitives are child nodes; cross-links are `Reference`-typed attributes
  holding `<../Edge_x>`-style relative paths.
- **Compiled layer** (in-memory, derived at load): a new **Brep assembler**
  walks the composed Brep subtree, resolves every relative reference against the
  post-composition tree, and produces the existing flat-indexed `Brep` object
  **plus a parallel `faceNames: string[]`** (authored child segment per face).
- `tessellate.ts` (≈49 KB of index logic) and `brep-validate.ts` keep consuming
  the flat `Brep` **essentially untouched**. The flat array is now legitimately
  "derived/cache-only" — exactly the category the children-vs-attributes rule
  says stays out of the authored form.

This collapses the risk surface: the boolean/NURBS/surface-frame tessellation
math does not move. We add a resolver + assembler at the boundary, and rewire
the loader and viewer.

### Why composition doesn't need to understand references

The composer (`composition/compose.ts`) already recursively composes `children`
(a `name → absolute-path` map) — so authoring `Body/Face_3` as a real child node
"just works," including federated opinions merged onto it from other layers.

The composer does **not** need to resolve `<../Edge_x>` data references. Those
are carried as opaque attribute *values* through composition and resolved later,
only by the Brep assembler (for tessellation) and the viewer (for per-face
materials). Keeping composition reference-agnostic is deliberate — it means no
change to the core composition engine.

---

## 2. The authored form, concretely (Hello Brep Cube)

### Before — one flat row in `ifcx.geom.brep.ndjson`

```jsonc
{"vertices":[{"Point":[0,0,0]}, ...8],
 "curves":[{"bsi::ifc::geometry::brep::line":{"Pnt":[0,0,0],"Dir":[1,0,0]}}, ...],
 "edges":[{"CurveIndex":0,"StartVertex":0,"EndVertex":1}, ...12],
 "loops":[{"EdgeList":[{"EdgeIndex":0,"Reversed":true}, ...]}, ...6],
 "faces":[{"SurfaceIndex":0,"OuterLoop":0,"SameSense":true}, ...6],
 "shells":[{"FaceList":[0,1,2,3,4,5]}],
 "regions":[{"ShellList":[0]}]}
```

Per-face color was authored at a **latent** path `Body/Face_3` and absorbed by
the loader into the parent as the flattened key
`ifcx::brep::face::3::bsi::ifc::presentation::diffuseColor`.

### After — Brep node with topology children

Composed (logical) view of the Brep at path `Body`:

```
Body                      (Brep node)
  attributes:
    bsi::ifc::geometry::brep::meta -> { Tolerance, sourceHash, derivedFrom }  # cache-only
  children: Vertex_0..7, Edge_0..11, Loop_0..5, Face_0..5, Shell_0, Region_0

Body/Vertex_0   { Point: [0,0,0] }
Body/Edge_0     { Curve: {bsi::ifc::geometry::brep::line:{Pnt,Dir}},   # inline geometric carrier
                  Start: "<../Vertex_0>", End: "<../Vertex_1>" }       # Reference attrs
Body/Loop_0     { EdgeList: [ {Edge:"<../Edge_0>",Reversed:true},
                              {Edge:"<../Edge_3>",Reversed:false}, ... ] }
Body/Face_0     { Surface: {bsi::ifc::geometry::brep::plane:{...}},     # inline geometric carrier
                  OuterLoop: "<../Loop_0>", InnerLoops: [], SameSense: true }
Body/Shell_0    { FaceList: ["<../Face_0>", "<../Face_1>", ...] }
Body/Region_0   { ShellList: ["<../Shell_0>"] }
```

**The federation win** (replaces latent paths): a separate layer authors
`Body/Face_3` with `bsi::ifc::presentation::diffuseColor`. Ordinary composition
merges that opinion onto the **real** `Face_3` node. No latent absorption, no
`ifcx::brep::face::3::…` flattened keys, no `GeomSubset`-style indirection prim.
This is the IFCX-distinctive property, now expressed through the *standard*
layering model rather than a loader trick.

### Wire encoding in the index-file format

Each topology primitive is one `IfcxNode` in `index.ifcx` whose single geometry
attribute references one row in `ifcx.geom.brep.ndjson` — so the table changes
**from one row per Brep to one row per primitive**, each row carrying that
primitive's local fields including its `<../rel>` references. The index file
stays lean (node + children + one attribute ref each). Reference resolution
happens in the assembler/viewer, after the loader injects each row as its node's
attributes. (Sub-decision S2: alternatively extend the index format with inline
scalar attributes for the light wiring — not recommended; the per-primitive-row
approach reuses the existing table mechanism unchanged.)

### Reference syntax & resolution (net-new, small)

- A reference is a `Reference`-typed attribute value: the string `"<P>"` where
  `P` is a path. `../` ascends one segment **relative to the carrying node's
  composed path**; a leading `/` (or bare UUID head) is absolute. Mirrors USD
  `<...>` relationship-target syntax.
- New helpers in `composition/path.ts`: `GetParent(path)`, `ResolveRelative(base, rel)`.
- Resolution is **not** done during composition. It is done by the Brep
  assembler and the viewer against the post-composition tree.

---

## 3. Workstream 1 — Kill index addressing, adopt path references

**Problem fixed:** `Face_0` as an ordinal has no persistent identity across a
boolean. Persistent-naming problem; conceded to Thomas.

Files: `src/ifcx-core/geometry/geometry-tiers.ts`, `brep-validate.ts`,
`attribute-table.ts`, `composition/path.ts` (new helpers),
`geometry/index-file-loader.ts`, `standard/ifcxfile/geometry-tiers/Brep*.json`,
`schema/ifcx-geometry-tiers.tsp`. **New:** `geometry/brep-assembler.ts`,
`geometry/brep-reference.ts`.

Tasks:

1. **Authored types.** Add child-node topology types to `geometry-tiers.ts`:
   `BrepVertexNode { Point }`, `BrepEdgeNode { Curve, Start, End }`,
   `BrepLoopNode { EdgeList: {Edge,Reversed}[] }`,
   `BrepFaceNode { Surface, OuterLoop, InnerLoops?, SameSense }`,
   `BrepShellNode { FaceList }`, `BrepRegionNode { ShellList }`, where every
   cross-link is a `BrepRef = string` (`"<../…>"`). Keep the existing
   flat-indexed `Brep` as the **compiled** type, re-commented as in-memory only.
2. **Brep assembler** (`brep-assembler.ts`): given the composed Brep subtree
   (`PostCompositionNode`) → `{ brep: Brep, faceNames: string[] }`. Resolves
   relative refs, deterministically orders primitives (authored child order),
   builds the flat arrays the tessellator wants. This is the single new piece of
   index-assignment logic; it is the inverse of the old importer packing.
3. **Reference resolver** (`brep-reference.ts`): `resolveRef`, `parseRef`,
   relative-path arithmetic; unit-tested in isolation.
4. **Remove latent-path absorption** from `index-file-loader.ts`
   (`resolveLatentBrepPaths`, the `data.filter` drop, the `ifcx::brep::<kind>::<n>`
   key synthesis). Per-face attributes now live on real composed child nodes.
5. **Remove latent-path helpers** from `geometry-tiers.ts`
   (`parseLatentBrepPath`, `LatentBrepPath`, the three regexes) — superseded by
   real child nodes.
6. **Validator** (`brep-validate.ts`): keep operating on the compiled flat `Brep`
   (it runs after assembly). No logic change beyond accepting the assembler's
   output; optionally surface `faceNames` in the report.
7. **Identity source** (WS1's stated requirement, detailed in
   [boolean-output-identity.md](boolean-output-identity.md)): authored UUIDs /
   stable content keys preserved across import; derived (boolean) topology gets a
   deterministic provenance-derived name + a cache-only `derived_from`
   attribute; cross-kernel stability explicitly **not** guaranteed.

**Gating sub-question for Thomas (open question 1):** is provenance-back-to-input
acceptable, or does the group want derived topology treated as flatly
non-persistent? See the companion note. Lean (b)+scoped-(c).

---

## 4. Workstream 2 — Align tiers to the roadmap's three levels

Files: `docs/geometry-tiers-design.md`, `geometry/tier-resolver.ts`,
`geometry/geometry-tiers.ts` (the `GeometryTier` type + comments), schema doc
comments.

- Adopt the bSI Technical Roadmap (p.14) **three-level** vocabulary —
  **Level 1 mesh / Level 2 explicit Brep / Level 3 procedural** — as the
  documented framing and in type naming/comments, retiring the parallel
  P/B/M names in prose. Keep the **source-of-truth rule** (highest level present
  wins → procedural is authoritative) and the derivation contract.
- **Wire stability (recommended):** keep the table filenames
  `ifcx.geom.{proc,brep,mesh,ext}` and the attribute keys as-is to avoid a
  gratuitous rename touching every example and importer. Roadmap vocabulary
  lives in docs + a `GeometryLevel` alias of `GeometryTier`. (Sub-decision S3:
  a full rename to roadmap names is possible but is pure churn; flag, don't do
  by default.)
- **Position Advanced Brep honestly:** kept for completeness, explicitly **not**
  a primary exchange path. Document the implementation pitfalls (kernel-specific
  tolerance, NURBS trim fidelity, non-manifold edge cases) and the limited
  exchange utility rather than implying parity with procedural.
- **Tier B3 (external reference: STEP / Parasolid / JT)** stays the honest opaque
  passthrough; it does not compose and is **unaffected** by the children rework.

---

## 5. Workstream 3 — Converge the two procedural vocabularies

**Problem (confirmed):** the legacy `examples/Hello Wall/hello-wall.ifcx` carries
its body as `usd::usdgeom::mesh::points` plus `usd::usdgeom::basiscurves` axis
lines (the "extrusion direction + basis") and `usd::xformop::transform`
placements — disjoint from the `bsi::ifc::geometry::procedural::*` keys the
tiered examples already use.

Files: `examples/Hello Wall*`, `geometry-tiers.ts`,
`standard/ifcxfile/geometry-tiers/ProceduralGeometry.json`, `Profile.json`,
`src/ifcx-core/step21/ifc-procedural.ts`.

- **Pick one vocabulary (recommended):** standardize authored solid geometry on
  `bsi::ifc::geometry::procedural::*`. It is already the de-facto tiered
  vocabulary, mirrors the existing `bsi::ifc::procedural_geometry::has_profile`
  lineage, and sits in the buildingSMART-owned namespace appropriate for
  IFC-derived geometry.
- **Clean namespace division to propose:**
  - **Placement** → `usd::xformop::transform` (USD's native domain — keep).
  - **Display mesh (Level 1)** → `usd::usdgeom::mesh::*` (what the viewer already
    reads — keep).
  - **Authoring / procedural (Level 3) + Brep (Level 2)** → `bsi::ifc::geometry::*`.
- **Apply the children/attributes rule:** the procedural *operation* and its
  operands (profile, direction, depth) are **attributes** on the element; any
  operand that is itself addressable topology is referenced by **path**
  (this is what makes WS4 possible).
- **Migrate hello-wall:** re-express the wall **Body** as
  `extruded_area_solid` (profile × height). The `basiscurves` **Axis** line is a
  separate IFC representation (1D curve), not solid body geometry — retain it as
  an explicit curve/representation annotation if wanted, but it is not part of
  the procedural body. Re-export all `Hello Wall*` examples in current IFCX
  syntax so they stop carrying the legacy USD body form.

**Gating sub-question for Thomas (open question 2):** converge on
`bsi::ifc::geometry::procedural::*`, or is there a roadmap-preferred namespace to
adopt instead?

---

## 6. Workstream 4 — Make Level-3 operands referenceable (the demonstration piece)

Forward-looking; not a full spec. The children model must *enable* it so we can
show IFC5 is not a dumbed-down IFC4.

- Because topology is now addressable children, a generative function or
  constraint can reference `Body/Edge_3` as an operand **by path**. The same
  `<../…>` / absolute-path machinery from WS1 resolves it against the
  post-composition tree — confirm with one worked example.
- Build one small example aligned with Thomas's parametric-ifc5 proposal:
  a **function-as-sub-primitive operating on the post-composition tree, emitting
  a layer** — e.g. a `fillet`/`chamfer` feature node, or a constraint, that
  references a named edge and authors a derived-geometry layer. The point is
  proof that the **operand resolves**, not a parametrics spec.
- **Graceful degradation (hard requirement):** ship the explicit/derived
  geometry alongside, so a viewer without parametric support renders ordinary
  attribute/explicit data; parametric behaviour only where supported.

This is the "IFC5 has appropriate complexity" argument made concrete, and it is
sequenced **last** (it depends on a stable children model).

---

## 7. Workstream 5 — Importers, schema, tests, examples

Files: `src/ifcx-cli/ifc-to-tiered.ts`, `ap242-to-tiered.ts`,
`src/ifcx-core/step21/*`, `geometry/alpha-to-tiered.ts`,
`schema/ifcx-geometry-tiers.tsp`, `standard/ifcxfile/geometry-tiers/*.json`,
`src/test/geometry-tier-test.ts`, all `examples/*`.

- **Importers emit children, not flat arrays.** Today index assignment lives in
  `ap242-brep.ts` (`BuildCtx` caches STEP id → ordinal) and the flat `Brep` is
  written as one ndjson row. Rework: walk the same STEP topology but **emit one
  node + one per-primitive row each**, assigning stable child names
  (preserve source identity where available; deterministic content key
  otherwise) and `<../…>` cross-links. GlobalIds still preserved as IFCX paths;
  the geometry body becomes a `Body` child whose subtree is the topology.
  - `ifc-to-tiered.ts`: procedural path is largely unaffected (Tier P already
    uses the target vocabulary); main change is hanging geometry under a `Body`
    child consistently and dropping any latent face authoring.
  - `ap242-to-tiered.ts` + `ap242-brep.ts`: the real work — replace flat packing
    with child-node emission via a shared "Brep writer" (inverse of the
    assembler).
- **Schema → children model.** Update `ifcx-geometry-tiers.tsp`: `Brep` stops
  being a bag of parallel arrays; define the per-primitive node models and the
  `Reference` (`<…>`) value type for cross-links. Regenerate
  `standard/ifcxfile/geometry-tiers/*.json` via the TypeSpec pipeline
  (`tsp compile`, per `schema/package.json`). `BrepCurve.json` / `BrepSurface.json`
  / `Profile.json` / `ProceduralGeometry.json` / `DisplayMesh.json` /
  `ExternalGeometryReference.json` are largely stable; `Brep.json` is rewritten.
- **Tessellator/viewer face mapping.** `MeshFaceGroup.faceIndex` (array position)
  gains a companion **`faceName`** so per-face materials correlate to the
  composed face child node, not an ordinal. `tessellate.ts` threads the
  authored face name (from the assembler's `faceNames`) into each face group.
  The **viewer** (`web/viewer/render.mjs` ← `src/viewer/*.ts`): replace the
  `ifcx::brep::face::${i}::…` flattened-key lookup with a walk of composed
  `Body/Face_*` child nodes, matching a face group by `faceName` and reading the
  node's own material attributes. (Rebuild via `npm run build-viewer`.)
- **Tests** (`geometry-tier-test.ts`): rebuild fixtures in the children form;
  add tests for (a) cross-primitive relative refs resolving via the assembler,
  (b) federated per-face opinion merging onto a real `Face_n` node through
  composition (replacing the latent-absorption tests), (c) derived-topology
  identity / `derived_from` behaviour per WS1. Keep the tier-isolation test
  (mesh-only viewer never touches the procedural table) — it is unaffected and
  important.
- **Regenerate every example:** Hello Brep Cube, Hello Wall Tiered, Hello Wall
  (IFC4 imported) in the children form; migrate Hello Wall onto the procedural
  vocabulary (WS3); add the WS4 Level-3 proof example.

---

## 8. Sequencing

1. **Settle the two open questions on paper** — boolean-output identity (WS1,
   done in the companion note) and final procedural vocabulary (WS3). The
   vocabulary one needs Thomas. These gate the code.
2. **Schema + design doc** — WS2 vocabulary + the WS1 children model — so the
   contract is fixed before implementation churn. Freeze `Brep.json` shape and
   the `<…>` reference type here.
3. **Core model + assembler + validation (WS1)** — authored types, reference
   resolver, Brep assembler, loader de-latenting; tessellator stays put behind
   the assembler.
4. **Importers (WS5)** — once the target shape is stable; AP242 Brep writer is
   the bulk.
5. **Examples + tests (WS5)** — regenerate, rewrite fixtures, viewer rewire.
6. **One Level-3 proof example (WS4)** — last, as the demonstration piece.

---

## 9. Risk register

- **Tessellator regression** — mitigated by keeping `tessellate.ts` on the flat
  compiled `Brep`; assembler is the only new index logic and is unit-tested
  against the old fixtures' expected output.
- **Reference resolution edge cases** — `../` past root, dangling refs, absolute
  vs relative; isolate in `brep-reference.ts` with exhaustive unit tests; fail
  loud on dangling.
- **Index-file size / node count** — one node per primitive multiplies node
  count (a cube → ~26 nodes). Acceptable for correctness/identity; note it, and
  keep heavy geometry (points, curve/surface bodies) in the ndjson table rather
  than inline in the index file.
- **Viewer per-face materials** — the user-visible behaviour most likely to
  break; cover with a federated-color example + a viewer smoke test.
- **Schema regen drift** — TypeSpec → JSON must be regenerated, not hand-edited;
  verify `standard/ifcxfile/geometry-tiers/*.json` are emitter output.

---

## 10. What to send the group

A short note covering three things, with the Level-3 example as the punchline:

1. **The children-vs-attributes principle** — identity-bearing topology becomes
   authored children referenced by relative path; derived/cache-only data stays
   attributes. This kills ordinal `Face_0` addressing and gives federation a
   real node to layer onto (no `GeomSubset` indirection, no latent-path loader
   trick).
2. **Roadmap-level alignment** — our three tiers re-stated as the bSI Technical
   Roadmap's mesh / explicit-Brep / procedural levels, with Advanced Brep
   positioned honestly as non-primary-exchange and B3 external reference as
   opaque passthrough.
3. **Hello-wall convergence** — one procedural vocabulary
   (`bsi::ifc::geometry::procedural::*`), legacy USD body form retired.
4. **The Level-3 example** — a function/constraint that references a named edge
   by path and degrades gracefully — as the concrete "IFC5 has *appropriate*
   complexity, not dumbed-down IFC4" argument.

Offer the reworked branch as the concrete thing to react to.

### Two things to resolve with Thomas before coding

- **Boolean-output identity:** is provenance-back-to-input-faces acceptable, or
  does the group want derived topology treated as non-persistent?
  (See [boolean-output-identity.md](boolean-output-identity.md); we lean
  provenance + scoped non-guarantee.)
- **Procedural vocabulary:** converge on `bsi::ifc::geometry::procedural::*`, or
  is there a roadmap-preferred namespace to adopt instead?

---

## Appendix — sub-decisions flagged for confirmation (not blocking)

- **S1** — curve/surface geometry inlined as attributes on edge/face (recommended)
  vs authored as their own child nodes. Inlining = fewer nodes, matches "no
  identity worth referencing" for the geometric carrier.
- **S2** — per-primitive ndjson rows (recommended) vs extending the index format
  with inline scalar attributes for topology wiring.
- **S3** — keep wire table names `ifcx.geom.{proc,brep,mesh,ext}` (recommended)
  vs full rename to roadmap level names (pure churn).
