# Geometry tiers

IFCX carries geometry at three independent levels, aligned to the bSI Technical
Roadmap (p.14). Consumers load only the levels they need.

| Level | Roadmap name | Role | Storage |
|-------|--------------|------|---------|
| **3** | **Procedural** | Authoring level; the way AEC tools actually emit geometry. | `ifcx.geom.proc.ndjson`, tagged objects under `bsi::ifc::geometry::procedural::*` |
| **2** | **Explicit Brep** | Native explicit Brep. Used when Level 3 can't express the shape. Identity-bearing topology as child nodes. | `ifcx.geom.brep.ndjson`, one row per topology node |
| **1** | **Mesh** | Display geometry. Authored or derived from a higher level. | `ifcx.geom.mesh.ndjson` |

Source-of-truth rule: **the highest level present wins** (procedural > brep >
mesh). Lower levels may be derived/cached. The loader implements this — when the
mesh level is absent and a higher level is present, the tessellator derives mesh
on the fly.

> The historical tier names map directly: **Tier P = Level 3**, **Tier B =
> Level 2**, **Tier M = Level 1**. This doc uses the roadmap level names; the
> wire table filenames (`ifcx.geom.{proc,brep,mesh,ext}`) are unchanged.

## Where this diverges from USD

USD treats Brep as the authoring source and mesh as derived (OpenUSD's
`UsdSolid` proposal). For AEC that's backwards — walls are profile × height, not
surface assemblies. Level 3 (procedural) is the authoring level because that's
how IFC4 already encodes geometry.

USD's `GeomSubset` indirection prim for per-face properties is replaced by
**identity-bearing topology**: each face / edge / vertex of a Brep is an
addressable IFCX **child node**, so a federated layer attaches per-face
properties by authoring an opinion on the real `bodyPath/Face_<id>` node —
through ordinary IFCX composition, no indirection prim. See "Explicit Brep
(Level 2)" below.

USD's Radial Edge Data Model (`UsdSolidBrepAPI`) is replaced by IFC's manifold
lineage. AEC is overwhelmingly manifold; the simpler IFC topology is sufficient.

## Level 3 — Procedural

Solid operations: `ExtrudedAreaSolid`, `RevolvedAreaSolid`, `BooleanResult`.

Profile catalog: `Rectangle`, `Circle`, `IShape`, `LShape`, `Polyline`,
`CompositeCurve` (polyline + three-point arcs), `ProfileWithVoids`,
`CompositeProfile`.

Encoding — single-key tagged objects, matching the existing
`bsi::ifc::procedural_geometry::has_profile` vocabulary:

```json
{
  "bsi::ifc::geometry::procedural::extruded_area_solid": {
    "SweptArea": {
      "bsi::ifc::geometry::procedural::rectangle": {
        "position": {"Location": [2.5, 0.15]}, "Width": 5, "Height": 0.3
      }
    },
    "ExtrudedDirection": [0, 0, 1],
    "Depth": 3
  }
}
```

The procedural *operation* and its operands (profile, direction, depth) are
attributes on the element. Any operand that is itself addressable topology is
referenced by **path** — which is what lets a Level-3 generative function or
constraint take `bodyPath/Edge_3` as an operand.

### Generative operands (forward-looking)

Because topology is identity-bearing children, a generative feature or constraint
can name a primitive as an operand and resolve it by path:

```json
{ "bsi::ifc::geometry::feature::fillet_edge": {
    "Edge": "</wall-body/Edge_3>", "Radius": 0.05 } }
```

The operand resolves to a real, addressable edge node carrying its geometry — the
thing that was impossible when an edge was an ordinal array index. It composes as
an ordinary layer/opinion, and degrades gracefully: a viewer with no parametric
support renders the explicit geometry and ignores the feature. This is a *proof
that operands resolve*, not a parametrics spec; the `feature::*` vocabulary is
illustrative. Worked example: `examples/Parametric Edge Feature/`.

Frame convention: profile-`(u, v)` maps to world axes via `ExtrudedDirection`.
Z-extrusion → XY profile. Y-extrusion → XZ profile (left-handed; tessellator
flips winding via the `parity` flag in `buildFrame`). X-extrusion → YZ profile.

`BooleanResult` is tessellated via BSP mesh CSG (`csg.ts`) to a Level-1 mesh; it
does **not** currently produce Level-2 Brep topology (so boolean-output face
identity is forward-looking — see the boolean-identity note).

## Level 2 — Explicit Brep

Topology is **identity-bearing**. Each primitive — vertex, edge, loop, face,
shell, region — is authored as a **child node** under the Brep body node, and
primitives reference one another by **relative path** (`<../Edge_3>`), resolved
against the post-composition tree — never by ordinal array index.

The whole solid is the subtree of nodes under the body node `P`:

```
P                       (Brep body node)        attrs: { Tolerance? }
  P/Vertex_<id>   { Point: [x,y,z] }
  P/Edge_<id>     { Curve: {bsi::ifc::geometry::brep::line:{Pnt,Dir}},
                    Start: "<../Vertex_a>", End: "<../Vertex_b>" }
  P/Loop_<id>     { EdgeList: [ {Edge:"<../Edge_0>", Reversed:true}, ... ] }
  P/Face_<id>     { Surface: {bsi::ifc::geometry::brep::plane:{...}},
                    OuterLoop: "<../Loop_0>", InnerLoops?: [...], SameSense: true }
  P/Shell_<id>    { FaceList: ["<../Face_0>", ...] }
  P/Region_<id>   { ShellList: ["<../Shell_0>"] }
```

Each `<id>` is a **stable authored identity** — a preserved UUID or a
content-derived key — never a recomputed ordinal. The geometric carrier of a
primitive (the curve of an edge, the surface of a face) is **inline** on its
node: the edge *is* its curve, the face *is* its surface; they carry no separate
identity.

One row of `ifcx.geom.brep.ndjson` is the attribute body of one such node
(validated by the `Brep` union schema — an `anyOf` over the per-primitive node
schemas). A topology node carries a single `ifcx::geom::brep` attribute
referencing its row; per-element opinions from other layers (a face material, an
edge tolerance) are separate attributes merged onto the same node by composition.

### References

A reference is a `Reference`-typed string `"<P>"` (USD relationship-target
syntax). `../` ascends one segment relative to the referencing node's composed
path; a leading `/` is absolute. References are **not** resolved during
composition — they are carried as opaque attribute values and resolved later by:

- the **Brep assembler**, which walks the composed Brep subtree, resolves every
  reference, and produces a compact in-memory structure for the tessellator and
  validator (the old flat-indexed `Brep` is now exactly this private compile
  target — derived, never authored); and
- the **viewer**, which correlates a tessellated face group with the composed
  `Face_<id>` node to apply its per-face material.

### Per-face properties through layering

A federated layer attaches per-face properties by authoring a node at the real
face path:

```json
{
  "path": "wall-body-uuid/Face_3",
  "attributes": [
    { "opinion": "VALUE", "name": "bsi::ifc::presentation::diffuseColor",
      "value": [0.2, 0.4, 0.9] }
  ]
}
```

Ordinary IFCX composition merges that opinion onto the real `Face_3` node. There
is no latent-path absorption and no `ifcx::brep::face::3::…` flattened keys — the
face is a first-class node. This is the IFCX-distinctive piece: federation gets
per-face properties through the standard layering model, no `GeomSubset`-style
indirection prim required.

### IFC-equivalent lineage

| IFCX | IFC |
|------|-----|
| `BrepBodyNode` | `IfcManifoldSolidBrep` / `IfcAdvancedBrep` |
| `BrepRegionNode` | wrapper for inner cavities |
| `BrepShellNode` | `IfcClosedShell` / `IfcOpenShell` |
| `BrepFaceNode` | `IfcAdvancedFace` |
| `BrepLoopNode` | `IfcPolyLoop` / `IfcEdgeLoop` |
| `BrepOrientedEdge` | `IfcOrientedEdge` |
| `BrepEdgeNode` | `IfcEdgeCurve` |
| `BrepVertexNode` | `IfcVertexPoint` |
| `BSplineCurve` | `IfcBSplineCurveWithKnots` / `IfcRationalBSplineCurveWithKnots` |
| `BSplineSurface` | `IfcBSplineSurfaceWithKnots` / `IfcRationalBSplineSurfaceWithKnots` |

Open-shell / non-manifold topology is accepted by the tessellator (each face
tessellates independently). `validateBrep()` in `brep-validate.ts` classifies an
assembled Brep as `closed_manifold` / `open_manifold` / `non_manifold` /
`degenerate` and reports laminar / spine edge counts.

### Advanced Brep is not a primary exchange path

NURBS surfaces/curves (`BSplineCurve`, `BSplineSurface`) and analytic surfaces
(cylinder, cone, sphere, torus) are in the catalog for completeness, but
explicit Advanced Brep is **not** positioned as a primary exchange path. Faithful
round-trip depends on kernel-specific tolerance, NURBS trim-curve fidelity, and
non-manifold edge handling that no two kernels agree on. Treat it as a
best-effort container, not as parity with the procedural level. Where a shape
can be expressed procedurally, that is the exchange path.

### Derived-topology identity

A face produced by a boolean has no pre-existing identity. The position
(settled): derived faces carry a cache-only provenance attribute
`bsi::ifc::geometry::brep::derived_from` referencing the contributing input
faces, get deterministic provenance-derived names (stable within a kernel at a
fixed tolerance), and are explicitly **not** guaranteed stable across kernels.
This does not yet fire in practice — booleans currently evaluate to mesh, not
Brep topology.

## Level 2b — External geometry reference

Honest container for opaque external geometry that doesn't compose: STEP, OCCT
brep, IFC SPF, Parasolid `.x_t`, JT, glTF, OBJ, PLY. Carries `format`, `uri`,
and optional `integrity` (Subresource-Integrity-style `sha256-<hex>`). Not
subject to IFCX composition. Tools that recognize the format may load the
external content for rendering or measurement; tools that don't pass it through.
Unaffected by the children model — it has no internal topology to address.

## Derivation contract (Level 1 — Mesh)

When `usd::usdgeom::mesh::points` is absent on a node, the loader derives a mesh
from the highest available level. Priority: procedural > brep > mesh.

`DisplayMesh` carries optional metadata for cache validation:
- `derivedFrom`: `"procedural"` | `"brep"`
- `tolerance`: tessellation tolerance in source units
- `sourceHash`: stable RFC 8785-style canonicalized SHA-256 of the source-level
  record (`sha256-<hex>`)
- `faceGroups`: when derived from Brep, maps triangle ranges back to source
  faces. Each group carries both `faceIndex` (position in the assembled Brep)
  and **`faceName`** (the stable face child-node segment, e.g. `Face_3`) — the
  viewer correlates by `faceName` to pull the composed face node's material.

## Tessellator

Pure TS, no kernel dependency. Lives in `src/ifcx-core/geometry/tessellate.ts`.

- **Level 3:** extrude + revolve via ear-clipping with hole bridging;
  `BooleanResult` via BSP-based mesh CSG (`csg.ts`, supports union / difference /
  intersection). Each face emits its own vertex block for flat per-face shading.
  Parity flag handles the left-handed Y-extrusion case.
- **Level 2:** the Brep assembler first resolves the authored child nodes and
  relative references into a compact in-memory structure; the tessellator then
  does per-face 2D projection onto the surface frame, triangulates, and maps back
  to 3D. `SameSense` respected; winding verified against the desired outward
  normal per face. Surface frames implement uv ↔ 3D for plane / cylinder / cone /
  sphere / torus / NURBS. CircleCurve edges sample the actual arc between
  start/end vertices. NURBS edges sample via Cox-de Boor evaluation (`nurbs.ts`).
  Face groups are emitted with the authored `faceName` so the viewer can apply
  per-face materials authored on the composed face nodes.

## Importers and round-trip

- **IFC4 / IFC4X3 / IFC2X3 → tiered IFCX**: `ifcx-cli ifc2tiered <in.ifc> <out-dir>`.
  Uses `@ifc-lite` for spatial / semantic structure + our minimal STEP21 reader
  (`src/ifcx-core/step21/`) for native procedural geometry extraction. IFC
  GlobalIds preserved as IFCX paths; geometry hangs off a `Body` child.
- **STEP AP242 → tiered IFCX (Level 2)**: `ifcx-cli ap2422tiered <in.stp> <out-dir>`.
  Same STEP21 reader; extracts `manifold_solid_brep` chains and emits them as
  Brep body subtrees (one node per topology primitive, references by path).
  Source entity identity is preserved as the stable child name where available.

See `docs/cross-industry-mapping.md` for the IFCX Level 2 ↔ PRC ↔ STEP AP242
catalog mapping.
