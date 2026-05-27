# Cross-industry mapping — IFCX Tier B ↔ PRC ↔ STEP AP242

Minimal, technical reference. Phase 7 of the geometry-tiers roadmap. Companion to `docs/geometry-tiers-design.md`.

This document is the catalog-level mapping between IFCX Tier B (the native Brep tier landed in v1.1) and the two adjacent industrial geometry catalogs:

- **PRC** — ISO 14739-1:2014, the geometry catalog underlying USD's `UsdSolid` proposal and Adobe's PRC interchange.
- **STEP AP242** — ISO 10303-242, the dominant exchange schema for mechanical CAD (Managed Model-Based 3D Engineering).

Catalog scope: only the entities present in IFCX Tier B v1.1 (planar surfaces, line/circle curves, manifold topology) are mapped here. NURBS curves/surfaces, non-manifold topology, and assembly/PMI features are listed as known gaps.

---

## Geometry primitives

### Curves

| IFCX Tier B | PRC (ISO 14739-1:2014) | STEP AP242 (ISO 10303-242) | IFC4 equivalent | Notes |
|---|---|---|---|---|
| `LineCurve { Pnt, Dir }` | `PRCLine` (origin + direction) | `line` (point + vector) | `IfcLine` | Direct correspondence. All three carry an origin and a direction; parameter range is unbounded on the curve, bounded by edge references. |
| `CircleCurve { Pnt, Axis, RefDirection, Radius }` | `PRCCircle` (center + axis + radius) | `circle` (axis2_placement_3d + radius) | `IfcCircle` | Direct correspondence. PRC and AP242 use an axis-placement triple (origin + Z axis + ref X axis) equivalent to IFCX's `Pnt` + `Axis` + `RefDirection`. |

### Surfaces

| IFCX Tier B | PRC | STEP AP242 | IFC4 equivalent | Notes |
|---|---|---|---|---|
| `PlanarSurface { Pnt, Axis, RefDirection }` | `PRCPlane` | `plane` | `IfcPlane` | Direct correspondence. All three define a 2D parametric plane via origin + normal + in-plane reference direction. |

### Vertices / Points

| IFCX Tier B | PRC | STEP AP242 | IFC4 equivalent | Notes |
|---|---|---|---|---|
| `BrepVertex { Point: [x, y, z] }` | `PRCPoint3D` | `cartesian_point` | `IfcCartesianPoint` | Direct correspondence. PRC and AP242 also support 2D variants; IFCX Tier B is 3D-only by design (2D coords live in profile records under Tier P). |

---

## Topology entities

| IFCX Tier B | PRC | STEP AP242 | IFC4 equivalent | Notes |
|---|---|---|---|---|
| `BrepEdge { CurveIndex, StartVertex, EndVertex }` | `PRCEdge` (curve reference + start/end parameters or vertices) | `edge_curve` (edge_geometry + edge_start + edge_end + same_sense) | `IfcEdgeCurve` (subtype of `IfcEdge`) | All four carry curve reference + start/end vertex. AP242 additionally has a `same_sense` flag indicating whether the edge's traversal direction matches the underlying curve; IFCX expresses this via `BrepOrientedEdge.Reversed` at use sites. |
| `BrepOrientedEdge { EdgeIndex, Reversed }` | `PRCCoEdge` (edge + orientation) | `oriented_edge` (edge_element + orientation) | `IfcOrientedEdge` | Direct correspondence. `Reversed=true` ↔ `orientation=.F.` in AP242. |
| `BrepLoop { EdgeList: OrientedEdge[] }` | `PRCLoop` (ordered list of co-edges) | `edge_loop` (edge_list) | `IfcEdgeLoop` | Direct correspondence. Ordered cycle of oriented edges; first edge's start vertex equals last edge's end vertex. |
| `BrepFace { SurfaceIndex, OuterLoop, InnerLoops?, SameSense }` | `PRCFace` (surface + outer wire + inner wires + sense) | `advanced_face` (face_surface + bounds + same_sense) | `IfcAdvancedFace` | Direct correspondence. AP242 represents loops via `face_bound` / `face_outer_bound` distinguishing outer/inner; IFCX uses explicit `OuterLoop` + `InnerLoops?`. |
| `BrepShell { FaceList: faceIdx[] }` | `PRCShell` (face list, closed or open) | `closed_shell` / `open_shell` (cfs_faces) | `IfcClosedShell` / `IfcOpenShell` | IFCX v1.1 is closed-shell manifold only. Open-shell support arrives with v2.1 non-manifold. |
| `BrepRegion { ShellList: shellIdx[] }` | `PRCBodyRegion` (outer + inner shells) | (no direct entity; modeled via `manifold_solid_brep` containing one outer shell) | (implicit in `IfcManifoldSolidBrep`) | IFCX's Region wraps shells to allow inner cavities (v1.2). AP242's `manifold_solid_brep` has exactly one outer; `brep_with_voids` adds void shells. |
| `Brep { vertices, curves, surfaces, edges, loops, faces, shells, regions, Tolerance? }` | `PRCConnex` / `PRCBody` | `advanced_brep_shape_representation` | `IfcAdvancedBrep` | The top-level body. IFCX packs all primitives in flat-indexed arrays for stable per-element addressing; PRC/AP242 use entity-by-entity references (each curve / face / edge is its own STEP entity). The mapping is structural-equivalent but layout-different. |

---

## IFCX-distinctive features (no PRC / AP242 equivalent)

These are intentional IFCX contributions that have no counterpart in the mechanical-CAD catalogs:

- **Latent-path face addressing** (`bodyPath/Face_<n>`). PRC and AP242 have no native concept of per-face property authoring through a path; they model per-face attributes either inline on the face entity (PRC: `face.attributes`) or via separate property association entities (AP242: `IfcRelAssociates*`-style). IFCX's federated layering targets the latent path directly.
- **Composition-tree inheritance** (`inherits` arcs, type-based instantiation). PRC and AP242 don't have a composition model; they're flat geometry catalogs. The closest AP242 analogue is `mapped_item` for instance reuse, but it lacks IFCX's typeobject/occurrence hierarchy.
- **Procedural tier (Tier P) coexistence**. PRC and AP242 carry Brep + tessellated mesh but not a separate procedural authoring tier. IFCX's source-of-truth rule (Tier P > Tier B > Tier M) is unique.

---

## Known gaps (IFCX → PRC / AP242 catalog directions)

Entities present in PRC / AP242 but NOT in IFCX v1.2 — known limitations queued for later versions:

- **NURBS curves** with knots, weights, control points → both PRC (`PRCNURBSCurve`) and AP242 (`b_spline_curve_with_knots`, `rational_b_spline_curve`) have them; IFCX adds `BSplineCurveWithKnots` in v1.3.
- **NURBS surfaces** (`PRCNURBSSurface`, `b_spline_surface_with_knots`, `rational_b_spline_surface_with_knots`) → IFCX v1.3.
- **Analytic surfaces** (cylinder, cone, sphere, torus, swept surfaces of revolution) → IFCX v1.3.
- **Trimmed curves with explicit parameter ranges** → IFCX edges currently use start/end vertex pairs; explicit parameter trim is v1.3.
- **Non-manifold topology** (laminar edges, spine edges, dangling wires) → IFCX v2.1.
- **PMI** (Product Manufacturing Information — GD&T, tolerances, surface finish) → separate semantic layer, not Tier B catalog work.

---

## Known gaps (PRC / AP242 → IFCX directions)

Entities present in IFCX but with no direct PRC / AP242 equivalent:

- **`IfcxNode` paths** (UUIDs + composition position) → PRC and AP242 use entity-IDs (`#1234=...`); the mapping requires a path-to-ID translation table.
- **Tier P procedural geometry** (`ExtrudedAreaSolid`, `RevolvedAreaSolid`, `BooleanResult` over profile catalog) → AP242 has `swept_area_solid`, `revolved_area_solid`, `boolean_result`; PRC has equivalents via `PRCSweptSolid`. Mapping is straightforward; conformance tests TBD.
- **Latent paths** (`bodyPath/Face_<n>` attribute targets) → no equivalent; must be flattened or dropped on export.

---

## Round-trip viability matrix (v1.2 scope)

Assuming the v1.2 IFCX Tier B catalog (planar surfaces, line/circle curves, manifold topology):

| Source → IFCX Tier B → Source | Round-trip viability | Notes |
|---|---|---|
| AP242 simple bracket (planar faces only) | **✓ Lossless** | All planes, lines, circles, vertices, edges, loops, faces, shells map directly. |
| AP242 with NURBS | **✗ Lossy** | NURBS surfaces drop to planar tessellation in v1.2. v1.3 lifts this restriction. |
| AP242 with conical/spherical/cylindrical analytic surfaces | **✗ Lossy** | Same — v1.3. |
| AP242 with non-manifold topology | **✗ Out of scope v1.x** | v2.1. |
| AP242 with PMI annotations | **✗ Out of scope** | Separate semantic layer. |
| AP242 assemblies with `mapped_item` | **Partial** | Body geometry round-trips; assembly tree maps to IFCX `inherits` arcs lossily (no per-instance transform diff). |

---

## What the conformance test should verify (future work)

A v1 conformance test suite (deferred to phase 7.1 milestone) should round-trip a representative AP242 sample through IFCX Tier B and back, then compare via the geometry-equivalence comparator (sample-based point-cloud distance, tolerance ≈ 1e-5 m). The expected pass set for v1.2 catalog is:

1. Cube (8 vertices, 12 edges, 6 planar faces, 1 closed shell)
2. Open prism (5 vertices, 9 edges, 5 planar faces — pyramid)
3. Rectangular plate with circular hole (planar faces with one inner loop)

Anything involving NURBS, analytic surfaces, or non-manifold topology is expected to fail v1.2 conformance and is documented in the gap list above.

---

## References

- PRC ISO 14739-1:2014 — *Document management — 3D use of Product Representation Compact (PRC) format — Part 1: PRC 10001*
- STEP AP242 ISO 10303-242 — *Industrial automation systems and integration — Product data representation and exchange — Part 242: Application protocol: Managed model-based 3D engineering*
- IFC4 — *ISO 16739-1:2018* — `IfcAdvancedBrep` and the IFC geometry resource family
- USD `UsdSolid` proposal — [OpenUSD-proposals: cad_geometry](https://github.com/aousd/OpenUSD-proposals/tree/p1-exact-geometry-problem-statement/proposals/cad_geometry)
- IFCX-CORE issue #3 — Entity identification ADR (relevant for path-vs-ID semantics across formats)
