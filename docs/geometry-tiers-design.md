# IFCX geometry tiers — design

Status: draft, branch `louistrue-geometry-tiers`.
Companion proposals reviewed: AOUSD CAD/BRep problem statement (`p1-exact-geometry-problem-statement/proposals/cad_geometry`) and Pixar OpenUSD LOD API (`lod/proposals/level-of-detail`).

## Decision

Three-tier geometry model, procedural-first:

- **Tier P — Procedural geometry** is the authoring tier and the primary source of truth where it can be expressed. Catalog: swept solids (extrude, revolve), booleans, and a profile catalog covering rectangles, circles, arbitrary closed profiles, I-shapes, L-shapes, with voids and composites.
- **Tier M — Display mesh** is a tessellated view of higher tiers, intended for rendering. It may be authored directly (legacy import, scanned geometry) or derived from Tier P/B.
- **Tier B — Native Brep** is reserved for v2. It carries explicit topology and parametric surfaces for shapes Tier P cannot express. Latent-path face addressing is the planned mechanism for per-face overrides (see "Tier B (deferred)" below).

Each tier is an independent NDJSON attribute table referenced from the index file. Consumers load only the tiers they need. Tier semantics — not file structure — is what changed.

The opaque STEP/OCCT blob form previously named "Tier B" has been removed. It will not return; if external interop is needed in v2 it returns as a typed reference with integrity hash, separate from native Tier B.

## Source-of-truth rule

For any node carrying geometry across multiple tiers:

1. The **highest tier present** is authoritative for analysis, quantity takeoff, code compliance, and federation overrides.
2. Lower tiers are derived/cached views. They may be on the wire for performance, but must be invalidated when the source tier changes.
3. A consumer that cannot understand a higher tier falls back to a lower tier the same way a legacy renderer falls back to `lod:default:index` in the USD LOD proposal.

Authoritative ordering: P > B > M. A node may carry Tier P alone; Tier M alone (legacy mesh-only); or any combination. P and B both present means P is authoritative *for procedural intent* and B is authoritative *for explicit geometry* — typically only one is procedurally derivable from the other and the rule is decided per use case.

## Why this shape and not USD's

The AOUSD problem statement and the LOD proposal are the right framing inputs, but IFCX is not USD. Three deliberate divergences:

1. **Authoring direction is inverted.** USD treats Brep as the authoring source and mesh as derived. In AEC, the authoring source is procedural — walls are profile × height, columns are profile × axis. Brep is the geometric truth a kernel computes from the procedural definition; tessellated mesh is the renderable approximation. Elevating procedural to Tier 1 matches how BIM authors actually think and preserves a lossless round-trip with IFC4 SPF.

2. **Per-face overrides via latent paths, not packed `GeomSubset`.** USD packs topology into one prim per body and exposes faces through `GeomSubset` (its own prim type). IFCX paths are latent — `bodyPath/Face_0/...` exists as an addressable target whether or not a node has been authored there. When Tier B lands, per-face properties (material, thermal, machining tolerance) target those latent paths directly and participate in IFCX composition the same way any other attribute does. This leverages IFCX's federation model in a way USD's per-prim composition cannot.

3. **Reuse the IFC catalog, document PRC mappings separately.** USD's eventual Brep schema targets the PRC ISO 14739-1:2014 catalog. IFCX adopts an IFC-equivalent catalog as the surface vocabulary (IfcBSplineCurveWithKnots, IfcRationalBSplineSurfaceWithKnots, the IfcSweptAreaSolid family). PRC compatibility is preserved through a documented mapping, not by adopting an alien vocabulary that AEC tools don't already speak.

The cad_geometry **principles** (native not opaque, coexistence, double precision, prim-count discipline, additive, grounded-in-theory, ship-early) carry over. The schema shape does not.

## Tier P starter catalog (v1)

### Solid operations

- **ExtrudedAreaSolid** — sweep a profile along a direction by a depth. Analog of `IfcExtrudedAreaSolid`.
- **RevolvedAreaSolid** — revolve a profile around an axis by an angle. Analog of `IfcRevolvedAreaSolid`.
- **BooleanResult** — union / difference / intersection over two procedural-geometry operands. Operands may nest. Analog of `IfcBooleanResult`.

Out of scope for v1: `SweptDiskSolid`, `FixedReferenceSweptAreaSolid`, `SectionedSolid`, free-form sweeps with rail curves. These return in v1.1 with the same encoding shape.

### Profile catalog

- **RectangleProfile** — center position, width, height.
- **CircleProfile** — center position, radius.
- **ArbitraryClosedProfile** — single closed outer curve built from a `Polyline` or `CompositeCurve` of polylines and three-point circular arcs.
- **IShapeProfile** — IFC `IfcIShapeProfileDef`-equivalent parameters (overall width/depth, web/flange thickness, fillet radius).
- **LShapeProfile** — IFC `IfcLShapeProfileDef`-equivalent parameters (depth, width, thickness, fillet/edge radius).
- **ProfileWithVoids** — exterior profile plus zero or more interior profiles (holes).
- **CompositeProfile** — collection of profiles (already present in the existing viewer profile vocabulary).

The existing curve primitives in `src/viewer/profile.ts` — `Polyline`, `CircularArc`, `CompositeCurve` — remain unchanged and are reused as the building blocks of `ArbitraryClosedProfile`.

## Encoding convention

The procedural geometry vocabulary already in use lives under the `bsi::ifc::geometry::procedural::*` namespace. Tier P extends this namespace with the solid operations. Each operation and each profile is encoded as a single-key tagged object:

```json
{
  "bsi::ifc::geometry::procedural::extruded_area_solid": {
    "profile": {
      "bsi::ifc::geometry::procedural::rectangle": {
        "position": [2.5, 0.15], "width": 5.0, "height": 0.3
      }
    },
    "direction": [0, 0, 1],
    "depth": 3.0
  }
}
```

This matches how `bsi::ifc::procedural_geometry::has_profile` already encodes profile-with-voids and composite-profile in `ifcx.semantics.ndjson`. No new wrapping pattern; existing profile readers compose forward to solids.

The Tier P attribute on a node points into `ifcx.geom.proc.ndjson` (NDJSON, one solid per row). The attribute name is `ifcx::geom::proc`, matching the established tier-table reference convention.

## Tier M — derivation contract

Tier M may be authored or derived. When derived, an entry carries optional metadata so consumers can validate the cache:

- `derivedFrom` — `"procedural"` | `"brep"` — which higher tier produced this mesh.
- `tolerance` — tessellation tolerance in source units.
- `sourceHash` — stable content hash of the source-tier record this mesh was derived from. A consumer comparing `sourceHash` to a freshly computed hash of the current source can detect cache staleness.

These fields are optional. A mesh without them is treated as authored (no source to validate against).

Tessellation responsibility is application-level. The spec does not mandate a kernel. A reference TS tessellator for the Tier P starter catalog will land alongside this schema — small profiles + extrude/revolve is tractable in pure JS without an external kernel.

## Tier B — Native Brep (v1.1 landed; NURBS in v1.2)

Tier B carries explicit topology and parametric surfaces. v1.1 ships the topology + minimal geometry catalog needed to demonstrate the model and the latent-path face addressing rule. NURBS curves/surfaces and non-manifold topology land in v1.2.

### Storage

One Brep is a single row in `ifcx.geom.brep.ndjson`. The row body packs all topology and geometry into flat-indexed arrays so faces, edges, and vertices each have a stable global index used both for internal references and for latent-path addressing.

```
Brep {
  vertices: BrepVertex[]        // [x,y,z] points
  curves:   BrepCurve[]         // tagged: line | circle
  surfaces: BrepSurface[]       // tagged: plane  (NURBS in v1.2)

  edges:    BrepEdge[]          // (curveIdx, startVertex, endVertex)
  loops:    BrepLoop[]          // OrientedEdge[]
  faces:    BrepFace[]          // (surfaceIdx, outerLoop, innerLoops?, sameSense)
  shells:   BrepShell[]         // FaceList: faceIdx[]
  regions:  BrepRegion[]        // ShellList: shellIdx[]
}
```

### Topology lineage (IFC-equivalent, not USD REDM)

| IFCX             | IFC                              | Notes                                         |
|------------------|----------------------------------|-----------------------------------------------|
| `Brep`           | `IfcManifoldSolidBrep`           | Closed-shell manifold (v1.1)                  |
| `BrepRegion`     | (wrapper)                        | Allows inner cavities in v1.2                 |
| `BrepShell`      | `IfcClosedShell`                 |                                               |
| `BrepFace`       | `IfcAdvancedFace`                |                                               |
| `BrepLoop`       | `IfcPolyLoop` / `IfcEdgeLoop`    |                                               |
| `BrepOrientedEdge` | `IfcOrientedEdge`              |                                               |
| `BrepEdge`       | `IfcEdge` / `IfcEdgeCurve`       |                                               |
| `BrepVertex`     | `IfcVertexPoint`                 |                                               |

We deliberately do NOT adopt the Radial Edge Data Model (USD's UsdSolid approach). REDM's edgeuse/faceuse structures are designed for fully general non-manifold geometry; AEC is overwhelmingly manifold and the simpler IFC topology model is sufficient. Non-manifold returns in v2.1 if real use cases demand it.

### Catalog scope (v1.1)

- **Curves:** `LineCurve` (point + direction), `CircleCurve` (center + normal + ref direction + radius).
- **Surfaces:** `PlanarSurface` (origin + normal + ref direction).
- **v1.2:** NURBS curves (`BSplineCurveWithKnots`), NURBS surfaces (`RationalBSplineSurfaceWithKnots`), cylindrical/spherical/conical analytic surfaces.

### Latent-path face addressing — the design contribution

A Brep at IfcxNode path `P` exposes the following addressable sub-paths **without requiring an IfcxNode to be authored at those paths**:

- `P/Face_<i>` — the `i`-th entry of `Brep.faces`
- `P/Edge_<i>` — the `i`-th entry of `Brep.edges`
- `P/Vertex_<i>` — the `i`-th entry of `Brep.vertices`

A federated layer wanting to attach a per-face property authors a node at the latent path:

```json
{
  "path": "wall-body-uuid/Face_3",
  "attributes": [
    { "opinion": "VALUE", "name": "bsi::ifc::material",
      "value": { "typeID": "ifcx.semantics", "componentIndex": 14 } }
  ]
}
```

The composer resolves `wall-body-uuid/Face_3` against the parent's Brep, attaches the attribute to that face. No `GeomSubset`-style indirection prim is needed.

This is what makes Tier B federation-friendly: the structural model engineer can add tolerances to one face of a fabricated steel connection without touching the rest of the assembly, and the energy modeler can stamp R-values on exterior wall faces without seeing the rest of the building. Both layers compose through IFCX's existing path-based opinion mechanism.

**v1.1 ships the addressing rule and the parser (`parseLatentBrepPath`).**

**v1.2 ships the loader integration.** When a node authored at `bodyPath/Face_<n>` (or `/Edge_<n>` / `/Vertex_<n>`) is loaded, the loader absorbs it into the parent Brep node under the attribute key `ifcx::brep::face::<n>` (or `edge::<n>` / `vertex::<n>`). The latent node is removed from the data array; the parent now carries the per-face attribute object that downstream consumers can read.

Dangling latent paths (no parent in the file) pass through as ordinary nodes — the loader recognizes them as latent only when the bodyPath resolves to an actual IfcxNode in the same file.

### What's intentionally out of v1.x

- **NURBS curves and surfaces.** PlanarSurface + LineCurve + CircleCurve only. (v1.3)
- **Non-manifold topology.** Closed-shell manifold first; non-manifold for mid-surface idealization arrives in v2.1.
- **CircleCurve arc sampling.** v1.2 tessellator currently chord-approximates CircleCurve edges between start/end vertices. Proper arc sampling lands with v1.3.
- **CSG kernel.** Required for `BooleanResult` (Tier P) and for proper window-through-wall rendering. Out of v1.x; needs a kernel binding.
- **External STEP / OCCT references.** If a tier for opaque external geometry is needed for legacy interop, it lands as a separate B3 tier (per Option D in the v1 planning doc), not as a fallback for Tier B.
- **`sourceHash` canonical computation.** Field is in the schema; the canonicalization rule and hashing function are deferred to v1.3.

## What's deliberately not in v1

- **Tier B** — native explicit Brep. (See above.)
- **Opaque external geometry references.** STEP-as-string and OCCT-as-base64 are removed. If they return, they return as an explicit interop tier with integrity hash, labeled as opaque.
- **Federation override of face geometry.** v1 supports per-face *property* overrides (when Tier B lands), not face-replacement semantics.
- **LOD heuristic prims.** The USD LOD proposal's heuristic+override mechanism is interesting but not required to ship procedural-first. Consumer-controlled fidelity is currently provided by tier selection, not by per-tier LOD items. If LOD-style mesh items become useful within Tier M (multiple mesh densities for one body), they will be added as a Tier M sub-mechanism, not as separate node prims.
- **Tessellation kernel binding.** Reference TS tessellator covers the starter catalog. Production tessellation (OCCT, Parasolid) is application responsibility.

## Migration

The existing `examples/Hello Wall Tiered` example will be rewritten:

- The wall body becomes Tier P: `ExtrudedAreaSolid` over `RectangleProfile` (5m × 0.3m), height 3m.
- The window frame becomes Tier P: `ExtrudedAreaSolid` over the existing `ProfileWithVoids` profile.
- The arched window frame becomes Tier P: `ExtrudedAreaSolid` over the existing arched `CompositeProfile`.
- Tier M entries become derived caches with `derivedFrom: "procedural"` and a source hash.
- The opaque-blob Tier B entry is deleted.

The viewer keeps loading Tier M directly for v1; tessellating Tier P at viewer-load is the next milestone. The viewer's tier-toggle UI evolves to "P / M" selection rather than "A / B / C."

## Open issues to revisit

- **Profile placement convention.** The existing `Rectangle` uses `position.Location` with center semantics. We adopt center semantics throughout the starter catalog. Documented here so it doesn't drift.
- **Boolean operand encoding.** The `BooleanResult.first/second` operands carry nested procedural geometry. JSON Schema for recursive unions is awkward; we keep the tagged-object convention and accept that schema validation tools will need a custom recursive resolver.
- **Tier P hash function.** `sourceHash` field referenced in Tier M derivation contract requires a canonical serialization to hash. Decision deferred until the tessellator lands.
- **Inheritance interaction.** Window_001 inherits from windowType (`aabb1122-...01`). Whether the inheritor's Tier P attribute is inherited, overridden, or composed is governed by the existing IFCX attribute opinion mechanism and does not need geometry-specific rules.
