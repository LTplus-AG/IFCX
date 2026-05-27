import "@typespec/json-schema";

using JsonSchema;

/**
 * Tiered geometry system for IFCX.
 *
 * Three independent tiers, stored as separate attribute tables:
 *
 *   Tier P (procedural) — the authoring tier; primary source of truth where it can be expressed.
 *                          Catalog: swept solids and booleans over a profile catalog.
 *   Tier M (mesh)       — display geometry. Authored or derived from Tier P/B.
 *   Tier B (brep)       — native explicit Brep. Reserved for v2.
 *
 * Source-of-truth rule: highest tier present wins. Lower tiers are derived/cached views.
 *
 * Encoding convention for Tier P table entries: single-key tagged objects in the
 * `bsi::ifc::geometry::procedural::*` namespace. Matches the existing profile vocabulary
 * already used by `bsi::ifc::procedural_geometry::has_profile`.
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
 * Emitted by Tier B tessellation; lets renderers apply per-face materials
 * authored via latent-path attributes (e.g. `bodyPath/Face_3`).
 */
model MeshFaceGroup {
    start: uint32;
    count: uint32;
    faceIndex: uint32;
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
// Tier B — Native Brep (v1.1 minimal: closed-shell manifold + planar surfaces)
// =============================================================================
//
// One Brep is a single row in ifcx.geom.brep.ndjson. Topology and geometry are
// packed into flat-indexed arrays so faces, edges, and vertices each have a
// stable global index used both for internal references and for latent-path
// face addressing (bodyPath/Face_<n>, bodyPath/Edge_<n>, bodyPath/Vertex_<n>).
//
// IFC-equivalent lineage:
//   Brep        ≈ IfcManifoldSolidBrep / IfcAdvancedBrep
//   Region      ≈ IfcClosedShell wrapper allowing inner cavities (v1.2)
//   Shell       ≈ IfcClosedShell
//   Face        ≈ IfcAdvancedFace / IfcFace
//   Loop        ≈ IfcPolyLoop / IfcEdgeLoop
//   OrientedEdge≈ IfcOrientedEdge
//   Edge        ≈ IfcEdge / IfcEdgeCurve
//   Vertex      ≈ IfcVertexPoint
//
// Catalog scope for v1.1: PlanarSurface, LineCurve, CircleCurve only.
// NURBS surfaces/curves, non-manifold topology, and per-face subset materials
// arrive in v1.2.

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

@jsonSchema
union BrepCurve {
    LineCurveTag,
    CircleCurveTag,
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

@jsonSchema
union BrepSurface {
    PlanarSurfaceTag,
}

// --- Topology ---

model BrepVertex {
    /** [x, y, z] in body-local coordinates */
    Point: float64[];
}

model BrepEdge {
    /** Index into Brep.curves */
    CurveIndex: uint32;
    /** Index into Brep.vertices */
    StartVertex: uint32;
    /** Index into Brep.vertices */
    EndVertex: uint32;
}

model BrepOrientedEdge {
    /** Index into Brep.edges */
    EdgeIndex: uint32;
    /** True: traverse from EndVertex → StartVertex (i.e., reversed) */
    Reversed: boolean;
}

model BrepLoop {
    /** Ordered list of oriented edges forming a closed cycle */
    EdgeList: BrepOrientedEdge[];
}

model BrepFace {
    /** Index into Brep.surfaces */
    SurfaceIndex: uint32;
    /** Index into Brep.loops — outer boundary (CCW seen from surface normal) */
    OuterLoop: uint32;
    /** Indices into Brep.loops — inner boundaries (holes through the face) */
    InnerLoops?: uint32[];
    /** If false, the surface normal is reversed to give the face's outward normal */
    SameSense: boolean;
}

model BrepShell {
    /** Indices into Brep.faces — must form a closed manifold for v1.1 */
    FaceList: uint32[];
}

model BrepRegion {
    /** Indices into Brep.shells — first is the outer shell; rest are cavities (v1.2) */
    ShellList: uint32[];
}

/**
 * Tier B entry. Encoded as the row body in `ifcx.geom.brep.ndjson`.
 *
 * Latent paths: a Brep at IfcxNode path `P` exposes the following addressable
 * sub-paths without requiring authored child nodes:
 *
 *   P/Face_<i>     — the i-th entry in `faces`
 *   P/Edge_<i>     — the i-th entry in `edges`
 *   P/Vertex_<i>   — the i-th entry in `vertices`
 *
 * Federated layers may target these latent paths to attach per-element
 * properties (e.g. per-face material, per-edge tolerance) that participate in
 * IFCX composition the same way any other attribute does.
 */
@jsonSchema
model Brep {
    vertices: BrepVertex[];
    curves: BrepCurve[];
    surfaces: BrepSurface[];

    edges: BrepEdge[];
    loops: BrepLoop[];
    faces: BrepFace[];
    shells: BrepShell[];
    regions: BrepRegion[];

    /** Geometric tolerance for vertex / edge comparisons, in body units */
    Tolerance?: float64;
}
