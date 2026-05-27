# Phases 6 & 7 — Interop planning

Status: planning draft, follows the v1.1/v1.2 work shipped in `fdef78a`.

Phases 0-5 of the original roadmap landed in `docs/geometry-tiers-design.md`. That work justifies the design. Phases 6 and 7 are interop layers — they turn the design into something the broader IFC and mechanical-CAD ecosystems can pull through.

These are bigger pieces than v1.x — each is a multi-day to multi-week scope with real dependency choices. This document spells out scope, options, milestones, and open questions before any code lands.

---

## Phase 6 — IFC4 SPF importer

### Purpose

Round-trip Tier P / Tier B / Tier M geometry (and minimal semantic) with the existing IFC4 / IFC4x3 STEP-physical-file ecosystem. Without this, IFCX has no path *from* the buildings already authored in Revit, ArchiCAD, Tekla, Allplan, etc.

What "round-trip" means concretely:
1. Read an IFC4 SPF file.
2. Convert every geometric entity to its Tier P (procedural) equivalent where possible, falling back to Tier B (native Brep) where Tier P can't express it, falling back to Tier M (display mesh) as a last resort.
3. Convert spatial structure (Site/Building/Storey) and minimal semantic (class + name + a few properties) to IFCX nodes.
4. Emit a complete IFCX file the viewer + tooling can load.
5. (Stretch) Inverse direction — IFCX → IFC4 — proves the catalog is lossless.

### Scope and dependencies

The hard problem is STEP parsing and the IFC4 schema layer. Three options:

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| A | Lean on IfcOpenShell (C++/Python) via WASM port or subprocess | Battle-tested; covers all of IFC | Heavy dep; deployment complexity; doesn't fit a pure-TS repo |
| B | Hand-write a STEP21 + IFC4 entity parser in TS | Zero external deps; full control | Hundreds of entities; weeks of work even for a subset |
| C | Build on **web-ifc** (WASM, by ThatOpen / IFC.js community) | De-facto standard for browser-side IFC parsing; TS bindings; open source; battle-tested; works in Node and browsers | One WASM dep; tied to its API; we don't control the parser |

**Recommendation: Option C.** web-ifc is what every other modern AEC-on-the-web project uses. We get a reliable parse for free and spend our effort on the IFC4 → IFCX mapping. The mapping is the value-add; the parser isn't.

### Catalog scope for v1 of the importer

Aligned with what IFCX v1.2 currently expresses. What we map vs defer:

| IFC4 entity | IFCX target | v1 status |
|-------------|-------------|-----------|
| `IfcExtrudedAreaSolid` | Tier P `ExtrudedAreaSolid` | **in scope** |
| `IfcRevolvedAreaSolid` | Tier P `RevolvedAreaSolid` | **in scope** |
| `IfcRectangleProfileDef` | Tier P `Rectangle` | in scope |
| `IfcCircleProfileDef` | Tier P `Circle` | in scope |
| `IfcIShapeProfileDef` | Tier P `IShape` | in scope |
| `IfcLShapeProfileDef` | Tier P `LShape` | in scope |
| `IfcArbitraryClosedProfileDef` | Tier P `CompositeCurve` profile | in scope |
| `IfcArbitraryProfileDefWithVoids` | Tier P `ProfileWithVoids` | in scope |
| `IfcCompositeProfileDef` | Tier P `CompositeProfile` | in scope |
| `IfcAxis2Placement3D` | placement matrix on the node (existing `usd::xformop::transform`) | in scope |
| `IfcAdvancedBrep` | Tier B `Brep` | **in scope** |
| `IfcFacetedBrep` | Tier B `Brep` (planar) | in scope |
| `IfcClosedShell` | Tier B `BrepShell` | in scope |
| `IfcAdvancedFace` + `IfcPlane` | Tier B `BrepFace` + `PlanarSurface` | in scope |
| `IfcFaceBound` + `IfcEdgeLoop` | Tier B `BrepLoop` | in scope |
| `IfcOrientedEdge` + `IfcEdgeCurve` | Tier B `BrepOrientedEdge` + `BrepEdge` | in scope |
| `IfcLine` | Tier B `LineCurve` | in scope |
| `IfcCircle` | Tier B `CircleCurve` | in scope |
| `IfcCartesianPoint` | Tier B `BrepVertex` | in scope |
| `IfcBooleanResult` (clipping/subtraction) | Tier P `BooleanResult` (record only) | **partial** — records the op; tessellation unsupported until CSG kernel |
| `IfcMappedItem` (typed instances) | IFCX `inherits` arc | in scope |
| `IfcWall` / `IfcWindow` / `IfcDoor` / `IfcBeam` / `IfcColumn` / `IfcSlab` | `bsi::ifc::class` semantic | in scope |
| `IfcMaterial` / `IfcMaterialLayerSet` | `bsi::ifc::material` | basic only |
| **Out of v1:** `IfcSweptDiskSolid`, `IfcSectionedSpine`, `IfcFixedReferenceSweptAreaSolid`, `IfcCsgPrimitive3D`, `IfcBSplineCurveWithKnots`, `IfcRationalBSplineSurfaceWithKnots` | (deferred) | needs v1.3 NURBS in IFCX |
| **Out of v1:** Pset properties, classifications, quantity sets | (deferred) | semantic layer, not blocking geometry round-trip |

### Milestones

| # | Title | Effort | Output |
|---|-------|--------|--------|
| 6.0 | Discovery & dependency selection | 1d | web-ifc spike; CLI signature decision; pick starter IFC test files (1 swept-solid model, 1 advanced-brep model) |
| 6.1 | STEP read + spatial walk | 2d | `ifcx-cli ifc2tiered <in.ifc> <out-dir>` — walks Site/Building/Storey, emits IFCX nodes with `bsi::ifc::class`. No geometry yet. |
| 6.2 | Tier P mapping (swept solids) | 3d | `IfcExtrudedAreaSolid` + `IfcRevolvedAreaSolid` + profiles → Tier P. Hello-wall-equivalent IFC4 file round-trips visually identical to the existing Hello Wall Tiered. |
| 6.3 | Tier B mapping (advanced Brep) | 3d | `IfcAdvancedBrep` + `IfcFacetedBrep` → Tier B. A simple Brep test file (mechanical bracket) round-trips. |
| 6.4 | Semantic mapping (minimal) | 2d | Wall / Window / Door / Beam class + Name. Material as `bsi::ifc::material` (code only, no presentation). |
| 6.5 | Conformance tests | 2d | Test suite over buildingSMART IFC4 sample files. CI integration. Visual diff against reference rendering. |
| **Total** | | **13d** | |

### Architecture sketch

```
ifcx-cli ifc2tiered
   │
   ├── web-ifc IFCAPI.OpenModel(buffer)
   │
   ├── walkSpatial(modelID)
   │     IfcSite → IfcBuilding → IfcBuildingStorey → element instances
   │     emits IfcxNode per element with children/inherits/class attribute
   │
   ├── convertGeometry(elementID)
   │     reads element's IfcProductDefinitionShape
   │     for each Representation:
   │       if SweptSolid → convertSwept() → Tier P record
   │       if AdvancedBrep → convertBrep() → Tier B record
   │       if MappedRepresentation → emit inherits arc
   │       else (CSG, complex sweeps) → fall back to tessellated mesh from web-ifc
   │
   ├── convertProfile(profileID) → Tier P profile (Rectangle/Circle/I/L/etc.)
   │
   ├── convertSurface(surfaceID) → Tier B PlanarSurface (NURBS deferred)
   │
   └── writeIndexFile(outDir) + writeNdjsonTables(outDir)
```

### Open decisions

1. **CLI vs library API.** Default to CLI for v1 (`ifcx-cli ifc2tiered`). Library wrapping comes after if there's demand from tool vendors.
2. **Coordinate-system handling.** IFC4 has `IfcGeometricRepresentationContext` with units, world coords, true-north. Decision: convert all to meters in world coords, document any project-coord offsets in the IFCX header.
3. **Material associations.** IFC4 has multiple paths (`IfcRelAssociatesMaterial`, layer sets, profiles). v1 captures the simplest case (single material per element); layered materials are deferred.
4. **Test file curation.** Need a stable set of IFC4 samples in `examples/` to test against. Candidates: the existing buildingSMART Hello Wall (`hello-wall.ifc` already in `examples/Hello Wall/`), the IFC test files repository on GitHub.
5. **Identifier strategy.** IFC GUIDs vs IFCX UUIDs — this connects to the ADR #3 discussion in IFCX-CORE. Decision: preserve IFC GUIDs as-is for path values (they're already valid IFCX identifiers per the path-of-GUIDs proposal); emit them in the IFCX file alongside any composition-position identifiers.

### Risks

- **web-ifc API changes.** It's actively developed. Pin to a known-good version.
- **IFC4 geometry edge cases.** Real-world IFC files have unusual patterns (rotated profiles, non-axis-aligned extrusions, missing references). v1 should fail-soft: log a warning, emit Tier M mesh fallback, continue.
- **CSG-heavy models.** A model that's primarily `IfcBooleanResult` (e.g., heavily clipped walls) will mostly emit Tier P boolean records that the v1 IFCX tessellator can't render. Visual diff against the source will look broken. Acceptable for v1; documented in the deferred list.
- **Schema variants.** IFC4 has multiple Model View Definitions (MVDs) — Reference View, Design Transfer View, Coordination View. Different tools emit different subsets. v1 targets the broadest constructs; gaps are documented.

### What deferred work looks like

- **6.6 — IFC2x3 importer.** Older but still common. ~3d extra; same architecture with a different schema layer.
- **6.7 — IFC4x3 importer.** Newer version. ~2d extra; mostly additive.
- **6.8 — Reverse direction (IFCX → IFC4 SPF).** Schema synthesis is the hard part. ~10d.
- **6.9 — Property sets / quantity sets.** Semantic layer expansion. ~5d.

---

## Phase 7 — Cross-industry PRC / STEP AP242 mapping

### Purpose

Demonstrate that IFCX Tier B isn't AEC-only — that it can round-trip with the mechanical-CAD ecosystem via STEP AP242 (the dominant CAD exchange format), and that its catalog has a clean mapping to PRC ISO 14739-1:2014 (the catalog USD's UsdSolid is targeting).

Two outputs:
1. **A mapping document** that pairs every IFCX Tier B entity to its PRC and STEP AP242 equivalents, and documents the gaps.
2. **A conformance test** that takes a real STEP AP242 file (a mechanical part), imports to IFCX Tier B, exports back to AP242, and verifies geometric equivalence within tolerance.

### Why this matters

- **USD interop.** UsdSolid targets PRC. If IFCX Tier B has a documented PRC mapping, cross-format interop becomes a tooling problem, not a spec problem.
- **AEC ↔ MFG bridge.** MEP equipment, prefabricated steel, embedded mechanical systems all originate in mechanical CAD and arrive in AEC via STEP. A working bridge unblocks digital-twin workflows.
- **Catalog validation.** If the IFCX Tier B catalog can't express what AP242 expresses (or vice versa), that's important spec feedback to surface before tools adopt.

### Scope and dependencies

The mapping document is desk research. The conformance test needs an AP242 reader.

| Reader option | Description | Verdict |
|---|---|---|
| OCCT (Open CASCADE) via WASM | Comprehensive STEP reader; heavy WASM blob | Best fidelity; biggest binary |
| Hand-written AP242 subset reader | Just enough to parse the test files | Manageable for v1 conformance tests; doesn't scale |
| Server-side conversion via existing tool (e.g. `stp2obj`, FreeCAD CLI) | Punt parsing to an external process | Cleanest for tests; brittle for prod |

**Recommendation: hybrid.** v1 conformance tests use a hand-written AP242 subset reader (~3d work) targeted at small test cases. Production-grade AP242 ingestion is deferred — if real demand emerges, switch to OCCT WASM.

### Milestones

| # | Title | Effort | Output |
|---|-------|--------|--------|
| 7.0 | PRC ↔ IFCX ↔ AP242 mapping doc | 3d | `docs/cross-industry-mapping.md`. Inventory IFCX Tier B; cross-reference each entity to PRC (ISO 14739-1) and STEP AP242 (ISO 10303-242). Document gaps both directions. |
| 7.1 | AP242 subset reader | 5d | TS module reading AP242 STEP files for: cartesian points, lines, circles, planes, advanced faces, advanced Breps. Tested against a handful of small AP242 sample files. |
| 7.2 | AP242 → IFCX Tier B converter | 3d | Wires 7.1 reader through to IFCX Tier B records. CLI: `ifcx-cli ap2422tiered <in.stp> <out-dir>`. |
| 7.3 | IFCX Tier B → AP242 writer | 5d | Inverse mapping. Validates the catalog is closed under round-trip (or documents what isn't). |
| 7.4 | Geometry equivalence comparator | 2d | Sample two Breps to dense point clouds; max-distance comparison. Pass if within tolerance (e.g. 1e-5 m). Used in conformance tests. |
| 7.5 | Conformance report | 1d | Document which AP242 entities round-trip cleanly. Update mapping doc with experimental results. |
| **Total** | | **19d** | |

### What the mapping document covers

A table per concept, three columns:

| IFCX Tier B | PRC (ISO 14739-1:2014) | STEP AP242 (ISO 10303-242) |
|---|---|---|
| `LineCurve` | Section 4.x — Line | `line` (AP242 entity) |
| `CircleCurve` | Section 4.x — Circle | `circle` |
| `PlanarSurface` | Section 5.x — Plane | `plane` |
| `BrepVertex` | — | `vertex_point` |
| `BrepEdge` | — | `edge_curve` |
| `BrepLoop` | — | `edge_loop` |
| `BrepFace` | — | `advanced_face` |
| `BrepShell` | — | `closed_shell` |
| `Brep` | (composite) | `advanced_brep_shape_representation` |

Plus a "what IFCX doesn't yet have but PRC/AP242 do" section:
- NURBS curves with knots
- NURBS surfaces (rational + non-rational)
- Cylindrical / spherical / conical / toroidal analytic surfaces
- B-spline composite surfaces
- Sweep along a 3D curve (rail curve)
- Topology features: parametric edge curves with explicit parameter range
- PMI (Product Manufacturing Information) — out of scope for IFCX Tier B; would need a separate semantic layer

And a "what IFCX has that PRC/AP242 doesn't" section:
- Federation-friendly latent-path face addressing (this is the IFCX-distinctive contribution — neither PRC nor AP242 has an equivalent)
- Composition-tree-based inheritance (`inherits` arc)
- Procedural-first tier with deferred CSG

### Open decisions

1. **AP242 sample files.** Need permissively-licensed test data. Candidates: CAx-IF (STEP CAx Implementor Forum) round-trip test suite, NIST CAD test models. Need legal review to confirm we can redistribute in the repo.
2. **Tolerance for equivalence.** PRC/AP242 represent geometry in double precision; IFCX Tier B also double precision. Sample-based comparison needs an explicit tolerance. Propose: 1e-5 m (10 µm), which is a typical CAD tolerance.
3. **Where to publish the mapping doc.** `docs/cross-industry-mapping.md` lives in this repo. Should we also publish on the IFCX-CORE wiki or as a buildingSMART technical note? Decision deferred to post-merge.
4. **OCCT WASM vs hand-rolled.** Defer the OCCT decision. v1 uses hand-rolled; if conformance tests start failing on real-world files we re-evaluate.

### Risks

- **PRC standard access.** ISO 14739-1:2014 is paywalled. The PRC technical specification is publicly available in summary form (via Adobe / Tech Soft 3D documentation), but the formal text isn't. Mitigation: lean on Adobe's published reference + USD UsdSolid's working catalog as the source of truth for v1.
- **AP242 schema scope.** AP242 has hundreds of entities. v1 covers the subset IFCX Tier B uses; complex AP242 features (assembly trees, kinematic constraints, PMI) are deferred. Documented as known limitations.
- **Round-trip lossiness.** Some AP242 features will not round-trip through v1 IFCX Tier B (e.g., NURBS surfaces, PMI). The conformance report must call these out explicitly.
- **No CI for STEP parsing.** Hand-rolled parsers are easy to regress. v1 conformance tests run a small fixed set of AP242 files; expansion needs OCCT WASM or similar.

---

## Cross-phase decisions

### Sequencing

Ship 6 before 7. Reasons:
- Phase 6 has a larger immediate audience (AEC) and unblocks adoption from existing IFC tools.
- Phase 7 builds on phase 6's geometry comparator and CI infrastructure.
- Phase 7 may surface catalog gaps that phase 6's IFC importer also hits — better to learn them in 7 than rediscover in 6.

### Shared infrastructure both phases need

- Geometry equivalence comparator (Brep ↔ Brep, mesh ↔ mesh). Built in 7.4 but used by 6.5 also.
- A `examples/` test corpus structure (IFC files in `examples/Hello Wall/`, AP242 files in a new `examples/Mechanical Bracket/` etc.).
- CLI plumbing for batch conversion (`ifcx-cli ifc2tiered`, `ifcx-cli ap2422tiered`, eventually `ifcx-cli tiered2ifc`).
- Visual diff in the viewer (load reference render alongside converted render).

### Things both phases reveal but don't block

- **Need CSG.** IFC4 files are full of `IfcBooleanResult` (wall-with-window-opening is typically a boolean clip). v1 importer records the op but can't tessellate it. Phase 6.x or v1.3 needs to add CSG.
- **Need NURBS.** Mechanical AP242 is full of NURBS surfaces. IFCX v1.2 doesn't have NURBS. Phase 7 will hit this wall immediately. Mitigation: v1 mapping doc + v1 conformance tests target only the non-NURBS subset; NURBS is a known gap.

### Estimated total

Phase 6: **~13 days** focused effort, dependent on web-ifc behaving.
Phase 7: **~19 days** focused effort, dependent on AP242 reader choice.

Together, with shared infrastructure and a week of cross-cutting overhead: **~5-6 weeks of focused work** to get both phases shipped.

---

## What we should decide before any code

1. **Phase 6 dependency: web-ifc or alternative?** Lock this before starting.
2. **Test corpus: which IFC4 files and which AP242 files?** Licensing matters.
3. **CLI naming.** `ifcx-cli ifc2tiered` and `ifcx-cli ap2422tiered`, or something else?
4. **Identifier strategy for imported files.** Preserve IFC GUIDs vs mint fresh IFCX UUIDs.
5. **Where the mapping doc lives.** This repo only, or also pushed upstream to IFCX-CORE / buildingSMART?
6. **CSG and NURBS roadmap.** Both phases hit these walls. Do we accelerate v1.3 (NURBS + CSG kernel) to land before phase 6/7 ships, or do we ship 6/7 with documented gaps and let v1.3 land later?

Items 1, 3, 4, 6 need user decisions. Items 2 and 5 are operational (legal review + governance) and can run in parallel with implementation.

---

## Phasing options

Given the 5-6 week total estimate, three ways to sequence:

**A — Sequential, minimal**
- 6.0-6.5 (13d) → 7.0-7.5 (19d) → done
- ~32d critical path
- Lowest risk, slowest

**B — Parallel after shared foundation**
- 6.0 (1d) + 7.0 (3d) in parallel, then 6.1-6.5 + 7.1-7.5 in parallel where possible
- ~22d critical path
- Higher risk (more concurrent decisions), faster

**C — Phase 6 only, defer 7**
- 6.0-6.5 (13d), publish, gather feedback, decide on 7 separately
- ~13d
- Best for getting AEC adoption started; defers mechanical CAD work

**Recommendation: C, with phase 7's mapping document (7.0, 3d) done in parallel.** This gets the highest-impact piece shipped fast, plus the strategic positioning doc for cross-industry interop, without committing to the larger phase 7 implementation work until there's signal that mechanical CAD interop is being asked for.
