import "@typespec/json-schema";

using JsonSchema;

/**
 * Tiered geometry system for IFCX, aligned to the bSI Technical Roadmap (p.14)
 * three geometry levels. Each level is an independent attribute table:
 *
 *   Level 3 — Procedural (table `ifcx.geom.proc`) — the authoring tier; primary
 *             source of truth where it can be expressed. Swept solids and
 *             booleans over a profile catalog.
 *   Level 2 — Explicit Brep (table `ifcx.geom.brep`) — native explicit Brep,
 *             used when Level 3 can't express the shape. Identity-bearing
 *             topology authored as child nodes (see the Brep section).
 *   Level 1 — Mesh (table `ifcx.geom.mesh`) — display geometry. Authored or
 *             derived from a higher level.
 *
 * Source-of-truth rule: the highest level present wins (procedural > brep >
 * mesh). Lower levels are derived/cached views.
 *
 * Encoding convention for procedural table entries: single-key tagged objects in
 * the `bsi::ifc::geometry::procedural::*` namespace. Matches the existing profile
 * vocabulary already used by `bsi::ifc::procedural_geometry::has_profile`.
 *
 * (The historical names Tier P / B / M map to Level 3 / 2 / 1 respectively.)
 */

// =============================================================================
// Tier P — Procedural Geometry
// =============================================================================

/** 2D point used by profile primitives. */
model Point2D {
    /** [x, y] */
    value: float64[];
}

/** Polyline (open or closed) as a sequence of 2D points. */
model PolylineBody {
    Points: float64[][];
}

/** Three-point circular arc: start, midpoint-on-arc, end. */
model CircularArcBody {
    Points: float64[][];
}

/** Curve assembled from polyline and arc segments. */
model CompositeCurveBody {
    Segments: (PolylineTag | CircularArcTag)[];
}

/** Position record matching the existing rectangle vocabulary. */
model Position2D {
    Location?: float64[];
}

/** Center-positioned rectangle. */
model RectangleBody {
    position?: Position2D;
    Width: float64;
    Height: float64;
}

/** Center-positioned circle. */
model CircleBody {
    position?: Position2D;
    Radius: float64;
}

/** IFC IfcIShapeProfileDef-equivalent. */
model IShapeBody {
    position?: Position2D;
    OverallWidth: float64;
    OverallDepth: float64;
    WebThickness: float64;
    FlangeThickness: float64;
    FilletRadius?: float64;
}

/** IFC IfcLShapeProfileDef-equivalent. */
model LShapeBody {
    position?: Position2D;
    Depth: float64;
    Width: float64;
    Thickness: float64;
    FilletRadius?: float64;
    EdgeRadius?: float64;
}

/** Profile with one exterior boundary and zero or more interior holes. */
model ProfileWithVoidsBody {
    exterior: Profile;
    Interior?: Profile[];
}

/** Collection of profiles drawn together. */
model CompositeProfileBody {
    Profiles: Profile[];
}

// --- Profile tag wrappers (single-key tagged objects) ---

model PolylineTag {
    `bsi::ifc::geometry::procedural::polyline`: PolylineBody;
}

model CircularArcTag {
    `bsi::ifc::geometry::procedural::circular_arc`: CircularArcBody;
}

model CompositeCurveTag {
    `bsi::ifc::geometry::procedural::composite_curve`: CompositeCurveBody;
}

model RectangleTag {
    `bsi::ifc::geometry::procedural::rectangle`: RectangleBody;
}

model CircleTag {
    `bsi::ifc::geometry::procedural::circle`: CircleBody;
}

model IShapeTag {
    `bsi::ifc::geometry::procedural::i_shape`: IShapeBody;
}

model LShapeTag {
    `bsi::ifc::geometry::procedural::l_shape`: LShapeBody;
}

model ProfileWithVoidsTag {
    `bsi::ifc::geometry::procedural::profile_with_voids`: ProfileWithVoidsBody;
}

model CompositeProfileTag {
    `bsi::ifc::geometry::procedural::composite_profile`: CompositeProfileBody;
}

/**
 * Profile (2D area or curve) used as input to solid operations.
 * A polyline or composite curve is accepted as a closed profile.
 */
@jsonSchema
union Profile {
    RectangleTag,
    CircleTag,
    IShapeTag,
    LShapeTag,
    PolylineTag,
    CompositeCurveTag,
    ProfileWithVoidsTag,
    CompositeProfileTag,
}

// --- Solid operations ---

/** 3D placement matching IFC IfcAxis2Placement3D. */
model Axis2Placement3D {
    Location: float64[];
    /** Local Z axis */
    Axis?: float64[];
    /** Local X axis */
    RefDirection?: float64[];
}

/** Extrude a profile along a direction by a depth. Analog of IFC IfcExtrudedAreaSolid. */
model ExtrudedAreaSolidBody {
    SweptArea: Profile;
    Position?: Axis2Placement3D;
    /** [dx, dy, dz] in profile-local frame; defaults to [0, 0, 1] if omitted by reader */
    ExtrudedDirection: float64[];
    Depth: float64;
}

/** Revolve a profile around an axis by an angle. Analog of IFC IfcRevolvedAreaSolid. */
model RevolvedAreaSolidBody {
    SweptArea: Profile;
    Position?: Axis2Placement3D;
    /** Axis origin in profile-local frame */
    AxisOrigin: float64[];
    /** Axis direction */
    AxisDirection: float64[];
    /** Revolution angle in radians */
    Angle: float64;
}

enum BooleanOperator {
    UNION: "union",
    DIFFERENCE: "difference",
    INTERSECTION: "intersection",
}

/** Boolean over two procedural-geometry operands. Operands may nest. Analog of IFC IfcBooleanResult. */
model BooleanResultBody {
    Operator: BooleanOperator;
    FirstOperand: ProceduralGeometry;
    SecondOperand: ProceduralGeometry;
}

// --- Solid tag wrappers ---

model ExtrudedAreaSolidTag {
    `bsi::ifc::geometry::procedural::extruded_area_solid`: ExtrudedAreaSolidBody;
}

model RevolvedAreaSolidTag {
    `bsi::ifc::geometry::procedural::revolved_area_solid`: RevolvedAreaSolidBody;
}

model BooleanResultTag {
    `bsi::ifc::geometry::procedural::boolean_result`: BooleanResultBody;
}

/**
 * Tier P entry. Each row in `ifcx.geom.proc.ndjson` is a single tagged object
 * representing one procedural solid.
 */
@jsonSchema
union ProceduralGeometry {
    ExtrudedAreaSolidTag,
    RevolvedAreaSolidTag,
    BooleanResultTag,
}

// =============================================================================
// Tier M — Display Mesh
// =============================================================================

enum MeshSourceTier {
    PROCEDURAL: "procedural",
    BREP: "brep",
}

/**
 * Maps a contiguous slice of faceVertexIndices back to its source Brep face.
 * Emitted by Brep (Level 2) tessellation; lets renderers apply per-face
 * materials authored on the composed face child node (e.g. `bodyPath/Face_3`).
 */
model MeshFaceGroup {
    start: uint32;
    count: uint32;
    /** Position of the face in the assembled Brep (in-memory compile order). */
    faceIndex: uint32;
    /** Stable name of the source face child node (e.g. "Face_3"); the durable
     * correlation key a renderer uses to find the face node's own attributes. */
    faceName?: string;
}

/** Tier M entry. Triangulated mesh for rendering. May be authored or derived. */
@jsonSchema
model DisplayMesh {
    /** Vertex positions as array of [x, y, z] triples */
    points: float64[][];

    /** Triangle vertex indices into the points array */
    faceVertexIndices: uint32[];

    /** Optional vertex normals as array of [nx, ny, nz] triples */
    normals?: float64[][];

    /** Optional UV coordinates as array of [u, v] pairs */
    uvs?: float64[][];

    /** Higher tier this mesh was derived from, if any. Absent means authored. */
    derivedFrom?: MeshSourceTier;

    /** Tessellation tolerance in source units, if derived */
    tolerance?: float64;

    /** Stable content hash of the source-tier record. Lets consumers detect cache staleness. */
    sourceHash?: string;

    /** Triangle-range → source-face mapping, emitted by Tier B tessellation. */
    faceGroups?: MeshFaceGroup[];
}

// =============================================================================
// Tier B3 — External geometry reference (interop, opaque)
// =============================================================================
//
// Honest container for external geometry: STEP, OCCT brep, IFC SPF, Parasolid x_t,
// JT, glTF, etc. Carries the URI, a content format tag, and an integrity hash.
//
// Not subject to IFCX composition. Not derivable. Loaders that don't recognize the
// format pass it through. Loaders that do may load the external content for
// rendering / measurement / round-trip but the contents stay outside IFCX semantics.

enum ExternalGeometryFormat {
    STEP_AP242: "STEP_AP242",
    STEP_AP203: "STEP_AP203",
    STEP_AP214: "STEP_AP214",
    IFC_SPF: "IFC_SPF",
    OCCT_BREP: "OCCT_BREP",
    PARASOLID_XT: "PARASOLID_XT",
    JT: "JT",
    GLTF: "GLTF",
    OBJ: "OBJ",
    PLY: "PLY",
}

@jsonSchema
model ExternalGeometryReference {
    /** Content format */
    format: ExternalGeometryFormat;
    /** URI or filesystem path to the external geometry payload */
    uri: string;
    /** Integrity hash of the referenced content; format "<algo>-<hex>", e.g. "sha256-abcdef...". Optional. */
    integrity?: string;
    /** Source units, if known. Default: producer's convention. */
    units?: string;
    /** Geometric tolerance, if known */
    tolerance?: float64;
}

// =============================================================================
// Level 2 — Explicit Brep (closed-shell manifold + planar / NURBS / analytic surfaces)
// =============================================================================
//
// Topology is identity-bearing: each primitive (vertex / edge / loop / face /
// shell / region) is authored as a CHILD NODE under the Brep body node, and
// primitives reference one another by RELATIVE PATH (BrepRef, e.g. "<../Edge_3>")
// resolved against the post-composition tree — never by ordinal array index.
// This gives every primitive a stable, layer-addressable identity: a federated
// layer attaches per-face properties by authoring an opinion on the real
// `bodyPath/Face_<id>` node, through ordinary IFCX composition (no latent-path
// absorption, no GeomSubset-style indirection prim).
//
// The flat-indexed in-memory `Brep` of earlier drafts is NOT a wire format; it
// is a private compile target produced by the Brep assembler (which resolves the
// references) and consumed by the tessellator/validator. See the Brep union
// below for the authored row shape.
//
// IFC-equivalent lineage:
//   BrepBodyNode  ≈ IfcManifoldSolidBrep / IfcAdvancedBrep
//   BrepRegionNode≈ IfcClosedShell wrapper allowing inner cavities (v1.2)
//   BrepShellNode ≈ IfcClosedShell
//   BrepFaceNode  ≈ IfcAdvancedFace / IfcFace
//   BrepLoopNode  ≈ IfcPolyLoop / IfcEdgeLoop
//   OrientedEdge  ≈ IfcOrientedEdge
//   BrepEdgeNode  ≈ IfcEdge / IfcEdgeCurve
//   BrepVertexNode≈ IfcVertexPoint
//
// Advanced Brep (NURBS surfaces/curves, non-manifold topology) is kept for
// completeness but is explicitly NOT a primary exchange path — see the design
// doc for the implementation pitfalls and limited exchange utility.

// --- Curve catalog ---

model LineCurveBody {
    /** Point on the line, world coords */
    Pnt: float64[];
    /** Unit direction vector */
    Dir: float64[];
}

model LineCurveTag {
    `bsi::ifc::geometry::brep::line`: LineCurveBody;
}

model CircleCurveBody {
    /** Center */
    Pnt: float64[];
    /** Normal of the plane the circle lies in */
    Axis: float64[];
    /** In-plane direction marking the 0-angle position */
    RefDirection: float64[];
    Radius: float64;
}

model CircleCurveTag {
    `bsi::ifc::geometry::brep::circle`: CircleCurveBody;
}

/**
 * Non-uniform rational B-spline curve (IFC IfcBSplineCurveWithKnots /
 * IfcRationalBSplineCurveWithKnots). Weights are optional; absent = non-rational.
 */
model BSplineCurveBody {
    Degree: uint32;
    /** Control points, each [x, y, z] */
    ControlPoints: float64[][];
    /** Knot vector */
    Knots: float64[];
    /** Multiplicity of each distinct knot (sums to ControlPoints.length + Degree + 1) */
    KnotMultiplicities?: uint32[];
    /** Optional per-control-point weights for rational curves */
    Weights?: float64[];
    /** True if the curve is closed (control points wrap) */
    Closed?: boolean;
}

model BSplineCurveTag {
    `bsi::ifc::geometry::brep::bspline_curve`: BSplineCurveBody;
}

@jsonSchema
union BrepCurve {
    LineCurveTag,
    CircleCurveTag,
    BSplineCurveTag,
}

// --- Surface catalog ---

model PlanarSurfaceBody {
    /** Point on the plane (the surface origin) */
    Pnt: float64[];
    /** Outward surface normal (unit) */
    Axis: float64[];
    /** In-plane reference direction (the local U axis) */
    RefDirection: float64[];
}

model PlanarSurfaceTag {
    `bsi::ifc::geometry::brep::plane`: PlanarSurfaceBody;
}

/**
 * Cylindrical surface. Origin = base center, Axis = cylinder axis,
 * RefDirection = 0-angle direction in the perpendicular plane.
 */
model CylindricalSurfaceBody {
    Pnt: float64[];
    Axis: float64[];
    RefDirection: float64[];
    Radius: float64;
}

model CylindricalSurfaceTag {
    `bsi::ifc::geometry::brep::cylinder`: CylindricalSurfaceBody;
}

/** Conical surface — Radius is at Pnt; expands along +Axis per SemiAngle. */
model ConicalSurfaceBody {
    Pnt: float64[];
    Axis: float64[];
    RefDirection: float64[];
    Radius: float64;
    /** Half-angle of the cone in radians */
    SemiAngle: float64;
}

model ConicalSurfaceTag {
    `bsi::ifc::geometry::brep::cone`: ConicalSurfaceBody;
}

/** Spherical surface — sphere centered at Pnt with given Radius. */
model SphericalSurfaceBody {
    Pnt: float64[];
    Axis: float64[];
    RefDirection: float64[];
    Radius: float64;
}

model SphericalSurfaceTag {
    `bsi::ifc::geometry::brep::sphere`: SphericalSurfaceBody;
}

/** Toroidal surface — torus centered at Pnt around Axis. */
model ToroidalSurfaceBody {
    Pnt: float64[];
    Axis: float64[];
    RefDirection: float64[];
    /** Major radius (axis center → tube center) */
    MajorRadius: float64;
    /** Minor radius (tube radius) */
    MinorRadius: float64;
}

model ToroidalSurfaceTag {
    `bsi::ifc::geometry::brep::torus`: ToroidalSurfaceBody;
}

/**
 * Non-uniform rational B-spline surface (IFC IfcBSplineSurfaceWithKnots /
 * IfcRationalBSplineSurfaceWithKnots). Tensor product of two NURBS curves.
 */
model BSplineSurfaceBody {
    UDegree: uint32;
    VDegree: uint32;
    /** Control grid: ControlPoints[i][j] is the [x, y, z] of (u_i, v_j) */
    ControlPoints: float64[][][];
    UKnots: float64[];
    VKnots: float64[];
    UKnotMultiplicities?: uint32[];
    VKnotMultiplicities?: uint32[];
    /** Optional weight grid Weights[i][j], same shape as ControlPoints (one less dim) */
    Weights?: float64[][];
}

model BSplineSurfaceTag {
    `bsi::ifc::geometry::brep::bspline_surface`: BSplineSurfaceBody;
}

@jsonSchema
union BrepSurface {
    PlanarSurfaceTag,
    CylindricalSurfaceTag,
    ConicalSurfaceTag,
    SphericalSurfaceTag,
    ToroidalSurfaceTag,
    BSplineSurfaceTag,
}

// --- Topology (identity-bearing nodes, referenced by relative path) ---
//
// Each model below is the attribute BODY of one Brep topology node. One row of
// `ifcx.geom.brep.ndjson` is one of these (validated by the Brep union). The
// node's identity is its authored path segment (`Vertex_<id>`, `Edge_<id>`, …);
// cross-links are BrepRef relative paths, not array indices.

/**
 * Relative- or absolute-path reference to another Brep topology node, wrapped in
 * angle brackets (USD relationship-target syntax). `../` ascends one segment
 * relative to the referencing node's composed path; a leading `/` is absolute.
 * Examples: "<../Edge_3>", "<../Vertex_0>".
 */
@pattern("^<[^>]+>$")
scalar BrepRef extends string;

/** Vertex node body — a point in body-local coordinates. */
@jsonSchema
model BrepVertexNode {
    /** [x, y, z] in body-local coordinates */
    Point: float64[];
}

/** Edge node body — a curve bounded by two vertex references. */
@jsonSchema
model BrepEdgeNode {
    /** Geometric carrier of the edge, inline (the edge *is* this curve). */
    Curve: BrepCurve;
    /** Reference to the start vertex node */
    Start: BrepRef;
    /** Reference to the end vertex node */
    End: BrepRef;
}

/** One oriented use of an edge within a loop. */
model BrepOrientedEdge {
    /** Reference to the edge node */
    Edge: BrepRef;
    /** True: traverse from End → Start (i.e., reversed) */
    Reversed: boolean;
}

/** Loop node body — an ordered cycle of oriented edge references forming a closed boundary. */
@jsonSchema
model BrepLoopNode {
    EdgeList: BrepOrientedEdge[];
}

/** Face node body — a surface bounded by an outer loop and optional inner loops. */
@jsonSchema
model BrepFaceNode {
    /** Geometric carrier of the face, inline (the face *is* this surface). */
    Surface: BrepSurface;
    /** Reference to the outer-boundary loop node (CCW seen from surface normal) */
    OuterLoop: BrepRef;
    /** References to inner-boundary loop nodes (holes through the face) */
    InnerLoops?: BrepRef[];
    /** If false, the surface normal is reversed to give the face's outward normal */
    SameSense: boolean;
}

/** Shell node body — face references that must form a closed manifold for v1.1. */
@jsonSchema
model BrepShellNode {
    FaceList: BrepRef[];
}

/** Region node body — shell references; first is the outer shell, rest are cavities (v1.2). */
@jsonSchema
model BrepRegionNode {
    ShellList: BrepRef[];
}

/** Brep body node — the root of a Brep subtree; topology hangs off it as children. */
@jsonSchema
model BrepBodyNode {
    /** Geometric tolerance for vertex / edge comparisons, in body units */
    Tolerance?: float64;
}

/**
 * Provenance for derived (e.g. boolean-output) topology. Authored as the
 * cache-only attribute `bsi::ifc::geometry::brep::derived_from` on a derived
 * face node: the operation plus references to the contributing input faces, so
 * annotations on durable input faces can be re-propagated after a re-evaluation.
 * Derived-face identity is best-effort and kernel-dependent (stable within a
 * kernel at a fixed tolerance; not guaranteed across kernels).
 */
@jsonSchema
model BrepDerivedFrom {
    operation: BooleanOperator;
    /** References to the contributing input-face nodes */
    sources: BrepRef[];
}

/**
 * One row of `ifcx.geom.brep.ndjson` — the attribute body of a single Brep
 * topology node. The whole solid is the subtree of such nodes under the Brep
 * body node, wired by relative-path references (BrepRef), not ordinal indices.
 *
 * A Brep body node at composed path `P` has children
 *   P/Vertex_<id>, P/Edge_<id>, P/Loop_<id>, P/Face_<id>, P/Shell_<id>, P/Region_<id>
 * where each `<id>` is a stable authored identity (preserved UUID or content
 * key), never a recomputed ordinal. A federated layer attaches per-element
 * properties by authoring an opinion on the real child node (e.g. a material on
 * `P/Face_3`) — ordinary IFCX composition.
 */
@jsonSchema
union Brep {
    BrepBodyNode,
    BrepVertexNode,
    BrepEdgeNode,
    BrepLoopNode,
    BrepFaceNode,
    BrepShellNode,
    BrepRegionNode,
}
