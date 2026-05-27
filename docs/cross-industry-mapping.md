# IFCX Tier B ↔ PRC ↔ STEP AP242

Catalog-level mapping for the v1.x scope (planar surfaces, line/circle curves, manifold topology). Companion to `geometry-tiers-design.md`.

Sources:
- PRC — ISO 14739-1:2014, the catalog underlying Adobe's PRC interchange and OpenUSD's `UsdSolid` proposal.
- STEP AP242 — ISO 10303-242, dominant mechanical-CAD interchange.
- IFC4 — ISO 16739-1:2018, geometry resource family.

## Curves

| IFCX Tier B | PRC | STEP AP242 | IFC4 |
|---|---|---|---|
| `LineCurve { Pnt, Dir }` | `PRCLine` | `line` | `IfcLine` |
| `CircleCurve { Pnt, Axis, RefDirection, Radius }` | `PRCCircle` | `circle` | `IfcCircle` |

All four define a line via origin + direction and a circle via origin + Z axis + ref X axis + radius. The mapping is structural-equivalent.

## Surfaces

| IFCX Tier B | PRC | STEP AP242 | IFC4 |
|---|---|---|---|
| `PlanarSurface { Pnt, Axis, RefDirection }` | `PRCPlane` | `plane` | `IfcPlane` |

Origin + normal + in-plane reference direction in all four.

## Vertices

| IFCX Tier B | PRC | STEP AP242 | IFC4 |
|---|---|---|---|
| `BrepVertex { Point }` | `PRCPoint3D` | `cartesian_point` | `IfcCartesianPoint` |

IFCX Tier B is 3D-only by design; 2D coords live in profile records under Tier P.

## Topology

| IFCX Tier B | PRC | STEP AP242 | IFC4 |
|---|---|---|---|
| `BrepEdge { CurveIndex, StartVertex, EndVertex }` | `PRCEdge` | `edge_curve` | `IfcEdgeCurve` |
| `BrepOrientedEdge { EdgeIndex, Reversed }` | `PRCCoEdge` | `oriented_edge` | `IfcOrientedEdge` |
| `BrepLoop { EdgeList }` | `PRCLoop` | `edge_loop` | `IfcEdgeLoop` |
| `BrepFace { SurfaceIndex, OuterLoop, InnerLoops?, SameSense }` | `PRCFace` | `advanced_face` | `IfcAdvancedFace` |
| `BrepShell { FaceList }` | `PRCShell` | `closed_shell` | `IfcClosedShell` |
| `BrepRegion { ShellList }` | `PRCBodyRegion` | (implicit in `manifold_solid_brep`; `brep_with_voids` adds void shells) | implicit in `IfcManifoldSolidBrep` |
| `Brep { ...flat-indexed arrays }` | `PRCConnex` / `PRCBody` | `advanced_brep_shape_representation` | `IfcAdvancedBrep` |

AP242's `same_sense` flag on `edge_curve` is expressed at use sites via `BrepOrientedEdge.Reversed` (`Reversed=true` ↔ `orientation=.F.`).

IFCX packs everything into flat-indexed arrays per Brep; PRC and AP242 use entity-per-line references. Layouts differ; the type system is equivalent.

## IFCX-distinctive (no PRC / AP242 equivalent)

- **Latent-path face addressing** (`bodyPath/Face_<n>`). PRC and AP242 model per-face attributes inline on the face or via separate property association entities. IFCX targets the latent path directly through standard layer composition.
- **Composition-tree inheritance** (`inherits` arcs, type-based instantiation). PRC and AP242 are flat geometry catalogs. AP242's `mapped_item` is the closest analogue but lacks IFCX's typeobject/occurrence hierarchy.
- **Procedural tier (Tier P) coexistence**. PRC and AP242 carry Brep + tessellated mesh; neither has a separate procedural authoring tier.

## Gaps — IFCX side

Entities present in PRC and AP242 but not IFCX v1.x:

- NURBS curves with knots (PRC `PRCNURBSCurve`; AP242 `b_spline_curve_with_knots`, `rational_b_spline_curve`) → IFCX v1.3
- NURBS surfaces (`PRCNURBSSurface`; `b_spline_surface_with_knots`, `rational_b_spline_surface_with_knots`) → IFCX v1.3
- Analytic surfaces — cylinder, cone, sphere, torus, surfaces of revolution → IFCX v1.3
- Explicit parameter range on trimmed curves → IFCX edges currently use start/end vertex pairs only
- Non-manifold topology — laminar edges, spine edges, dangling wires → IFCX v2.1
- PMI — GD&T, tolerances, surface finish → separate semantic layer, not Tier B catalog work

## Gaps — PRC / AP242 side

Things IFCX has that don't translate directly:

- `IfcxNode` paths (UUIDs + composition position) → PRC/AP242 use entity IDs; round-trip needs a path-to-ID table
- Tier P procedural operations — AP242 has `swept_area_solid` / `revolved_area_solid` / `boolean_result`; PRC has `PRCSweptSolid`. The mapping is straightforward but is Tier P work, not Tier B
- Latent-path attribute targets — must be flattened or dropped on export

## Conformance scope (when implemented)

A future conformance suite should round-trip a representative AP242 sample through IFCX Tier B and back, then compare via point-cloud distance at ~1e-5 m tolerance. The v1.x catalog can be expected to round-trip cleanly for:

- planar-face manifold bodies (cube, prism)
- planar bodies with circular holes (plate with bore)

NURBS, analytic surfaces, non-manifold topology, and PMI fall outside v1.x and are documented above as gaps, not failures.
