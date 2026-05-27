# Geometry tiers

IFCX carries geometry in three independent tiers. Consumers load only the tiers they need.

| Tier | Role | Storage |
|------|------|---------|
| **P — Procedural** | Authoring tier; the way AEC tools actually emit geometry. | `ifcx.geom.proc.ndjson`, tagged objects under `bsi::ifc::geometry::procedural::*` |
| **B — Brep** | Native explicit Brep. Used when Tier P can't express the shape. | `ifcx.geom.brep.ndjson`, packed topology + geometry in flat-indexed arrays |
| **M — Mesh** | Display geometry. Authored or derived from P/B. | `ifcx.geom.mesh.ndjson` |

Source-of-truth rule: **the highest tier present wins**. Lower tiers may be derived/cached. The loader implements this — when Tier M is absent and Tier P or Tier B is present, the tessellator derives mesh on the fly.

## Where this diverges from USD

USD treats Brep as the authoring source and mesh as derived (OpenUSD's `UsdSolid` proposal). For AEC that's backwards — walls are profile × height, not surface assemblies. Tier P is the authoring tier because that's how IFC4 already encodes geometry.

USD's `GeomSubset` indirection prim for per-face properties is replaced by **latent-path face addressing**: `bodyPath/Face_<n>` is an addressable sub-path of the Brep without authoring a child node. See "Latent paths" below.

USD's Radial Edge Data Model (`UsdSolidBrepAPI`) is replaced by IFC's manifold lineage. AEC is overwhelmingly manifold; the simpler IFC topology is sufficient.

## Tier P — Procedural

Solid operations: `ExtrudedAreaSolid`, `RevolvedAreaSolid`, `BooleanResult`.

Profile catalog: `Rectangle`, `Circle`, `IShape`, `LShape`, `Polyline`, `CompositeCurve` (polyline + three-point arcs), `ProfileWithVoids`, `CompositeProfile`.

Encoding — single-key tagged objects, matching the existing `bsi::ifc::procedural_geometry::has_profile` vocabulary:

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

Frame convention: profile-`(u, v)` maps to world axes via `ExtrudedDirection`. Z-extrusion → XY profile. Y-extrusion → XZ profile (left-handed; tessellator flips winding via the `parity` flag in `buildFrame`). X-extrusion → YZ profile.

`BooleanResult` is recorded but not tessellated — no CSG kernel in v1.x.

## Tier B — Native Brep

One Brep per row in `ifcx.geom.brep.ndjson`. Topology and geometry packed into flat-indexed arrays so faces/edges/vertices each have stable global indices used both for internal references and for latent-path addressing.

```
Brep {
  vertices:  BrepVertex[]    // [x,y,z]
  curves:    BrepCurve[]     // tagged: line | circle | bspline_curve
  surfaces:  BrepSurface[]   // tagged: plane | cylinder | cone | sphere | torus | bspline_surface

  edges:     BrepEdge[]      // (curveIdx, startVertex, endVertex)
  loops:     BrepLoop[]      // OrientedEdge[]
  faces:     BrepFace[]      // (surfaceIdx, outerLoop, innerLoops?, sameSense)
  shells:    BrepShell[]     // faceIdx[]
  regions:   BrepRegion[]    // shellIdx[]
}
```

IFC-equivalent lineage:

| IFCX | IFC |
|------|-----|
| `Brep` | `IfcManifoldSolidBrep` |
| `BrepRegion` | wrapper for inner cavities |
| `BrepShell` | `IfcClosedShell` / `IfcOpenShell` |
| `BrepFace` | `IfcAdvancedFace` |
| `BrepLoop` | `IfcPolyLoop` / `IfcEdgeLoop` |
| `BrepOrientedEdge` | `IfcOrientedEdge` |
| `BrepEdge` | `IfcEdgeCurve` |
| `BrepVertex` | `IfcVertexPoint` |
| `BSplineCurve` | `IfcBSplineCurveWithKnots` / `IfcRationalBSplineCurveWithKnots` |
| `BSplineSurface` | `IfcBSplineSurfaceWithKnots` / `IfcRationalBSplineSurfaceWithKnots` |

Open-shell / non-manifold topology is accepted by the tessellator (each face tessellates independently). `validateBrep()` in `brep-validate.ts` classifies a Brep as `closed_manifold` / `open_manifold` / `non_manifold` / `degenerate` and reports laminar / spine edge counts.

## Latent paths

A Brep at IfcxNode path `P` exposes the following addressable sub-paths **without authored child nodes**:

```
P/Face_<n>     n ∈ [0, faces.length)
P/Edge_<n>     n ∈ [0, edges.length)
P/Vertex_<n>   n ∈ [0, vertices.length)
```

A federated layer attaches per-face attributes by authoring a node at the latent path:

```json
{
  "path": "wall-body-uuid/Face_3",
  "attributes": [
    { "opinion": "VALUE", "name": "ifcx::semantics",
      "value": { "typeID": "ifcx.semantics", "componentIndex": 14 } }
  ]
}
```

The loader absorbs latent nodes into the parent under attribute keys `ifcx::brep::face::<n>` (and `edge::<n>`, `vertex::<n>`) and removes them from the data array. Dangling latent paths (no parent in the file) pass through as ordinary nodes.

The IFCX composer flattens nested attribute objects into double-colon keys, so post-composition the parent carries flat keys like `ifcx::brep::face::3::bsi::ifc::presentation::diffuseColor`. The viewer reads the flattened form.

This is the IFCX-distinctive piece — no PRC or AP242 equivalent. Federation gets per-face properties through the standard layering model, no `GeomSubset`-style indirection prim required.

## Tier B3 — External geometry reference

Honest container for opaque external geometry that doesn't compose: STEP, OCCT brep, IFC SPF, Parasolid `.x_t`, JT, glTF, OBJ, PLY. Carries `format`, `uri`, and optional `integrity` (Subresource-Integrity-style `sha256-<hex>`). Not subject to IFCX composition. Tools that recognize the format may load the external content for rendering or measurement; tools that don't pass it through.

## Derivation contract (Tier M)

When `usd::usdgeom::mesh::points` is absent on a node, the loader derives a mesh from the highest available tier. Priority: P > B > M.

`DisplayMesh` carries optional metadata for cache validation:
- `derivedFrom`: `"procedural"` | `"brep"`
- `tolerance`: tessellation tolerance in source units
- `sourceHash`: stable RFC 8785-style canonicalized SHA-256 of the source-tier record (`sha256-<hex>`)
- `faceGroups`: when derived from Brep, maps triangle ranges back to source faces — used by the viewer for per-face materials

## Tessellator

Pure TS, no kernel dependency. Lives in `src/ifcx-core/geometry/tessellate.ts`.

- Tier P: extrude + revolve via ear-clipping with hole bridging; `BooleanResult` via BSP-based mesh CSG (`csg.ts`, supports union / difference / intersection). Each face emits its own vertex block for flat per-face shading. Parity flag handles the left-handed Y-extrusion case.
- Tier B: per-face 2D projection onto the surface frame, triangulate, map back to 3D. `SameSense` respected; winding verified against the desired outward normal per face. Surface frames implement uv ↔ 3D for plane / cylinder / cone / sphere / torus / NURBS. CircleCurve edges sample the actual arc between start/end vertices. NURBS edges sample via Cox-de Boor evaluation (`nurbs.ts`).

## Importers and round-trip

- **IFC4 / IFC4X3 / IFC2X3 → tiered IFCX**: `ifcx-cli ifc2tiered <in.ifc> <out-dir>`. Uses `@ifc-lite` for spatial / semantic structure + our minimal STEP21 reader (`src/ifcx-core/step21/`) for native procedural geometry extraction. IFC GlobalIds preserved as IFCX paths.
- **STEP AP242 → tiered IFCX (Tier B)**: `ifcx-cli ap2422tiered <in.stp> <out-dir>`. Same STEP21 reader; extracts `manifold_solid_brep` chains.

See `docs/cross-industry-mapping.md` for the IFCX Tier B ↔ PRC ↔ STEP AP242 catalog mapping.
