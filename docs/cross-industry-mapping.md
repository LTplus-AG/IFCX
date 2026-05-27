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
| `BSplineCurve { Degree, ControlPoints, Knots, KnotMultiplicities?, Weights? }` | `PRCNURBSCurve` | `b_spline_curve_with_knots` / `rational_b_spline_curve_with_knots` | `IfcBSplineCurveWithKnots` / `IfcRationalBSplineCurveWithKnots` |

Cox-de Boor evaluation lives in `src/ifcx-core/geometry/nurbs.ts`. Rational curves use the optional `Weights` array; absent = non-rational.

## Surfaces

| IFCX Tier B | PRC | STEP AP242 | IFC4 |
|---|---|---|---|
| `PlanarSurface { Pnt, Axis, RefDirection }` | `PRCPlane` | `plane` | `IfcPlane` |
| `CylindricalSurface { Pnt, Axis, RefDirection, Radius }` | `PRCCylinder` | `cylindrical_surface` | `IfcCylindricalSurface` |
| `ConicalSurface { Pnt, Axis, RefDirection, Radius, SemiAngle }` | `PRCCone` | `conical_surface` | (n/a in IFC4) |
| `SphericalSurface { Pnt, Axis, RefDirection, Radius }` | `PRCSphere` | `spherical_surface` | `IfcSphericalSurface` |
| `ToroidalSurface { Pnt, Axis, RefDirection, MajorRadius, MinorRadius }` | `PRCTorus` | `toroidal_surface` | `IfcToroidalSurface` |
| `BSplineSurface { UDegree, VDegree, ControlPoints, UKnots, VKnots, ... }` | `PRCNURBSSurface` | `b_spline_surface_with_knots` / `rational_b_spline_surface_with_knots` | `IfcBSplineSurfaceWithKnots` / `IfcRationalBSplineSurfaceWithKnots` |

Each surface type has a uv ↔ 3D frame in the tessellator (`buildSurfaceFrame()` in `tessellate.ts`). NURBS surfaces use a uniform-sampling inverse mapping followed by golden-section refinement for projection.

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

## Gaps

What's still outside the IFCX Tier B catalog:

- **Surfaces of revolution** with non-trivial generator curves (AP242 `surface_of_revolution`, PRC `PRCSurfaceOfRevolution`). The analytic specializations (cylinder, cone, sphere, torus) are covered; the general form is not.
- **Trimmed curve with explicit parameter range** — IFCX edges identify their range via start/end vertex pairs. AP242's `trimmed_curve` with explicit parameter values is not currently captured.
- **PMI** (Product Manufacturing Information — GD&T, tolerances, surface finish). Belongs in a semantic layer above Tier B, not in the geometry catalog.

## What IFCX has that doesn't translate

- **`IfcxNode` paths** (UUIDs + composition position). PRC and AP242 use entity IDs (`#1234=...`); round-trip needs a path-to-ID table.
- **Tier P procedural operations** (`ExtrudedAreaSolid`, `RevolvedAreaSolid`, `BooleanResult`). AP242 has `swept_area_solid` / `revolved_area_solid` / `boolean_result`; PRC has `PRCSweptSolid` etc. Mapping is straightforward but happens at Tier P, not Tier B.
- **Latent-path attribute targets** (`bodyPath/Face_<n>::*`). Must be flattened to inline face properties or dropped on export.

## Conformance

The AP242 reader (`src/ifcx-core/step21/ap242-brep.ts`) round-trips:

- planar-face manifold bodies (cube, prism)
- planar bodies with circular and elliptical holes
- bodies with cylindrical, conical, spherical, toroidal surfaces
- B-spline curves and surfaces (degree, knots, control points, optional weights)

Hand-rolled AP242 conformance cube fixture lives in `src/test/geometry-tier-test.ts` (`buildAp242Cube`). For real-world AP242 files, a point-cloud distance comparator at ~1e-5 m tolerance is the suggested acceptance criterion.
