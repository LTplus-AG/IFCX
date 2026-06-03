// Tiered geometry types for IFCX.
//
// Three tiers:
//   P (procedural) — authoring tier; primary source of truth.
//   M (mesh)       — display geometry; authored or derived.
//   B (brep)       — native explicit Brep; reserved for v2.
//
// Source-of-truth rule: highest tier present wins. Lower tiers are derived/cached views.
// See docs/geometry-tiers-design.md for rationale.

// =============================================================================
// Tier P — Profile catalog (2D)
// =============================================================================

export type Point2D = [number, number];

export interface PolylineBody {
    Points: Point2D[];
}

export interface CircularArcBody {
    /** Three-point arc: start, midpoint-on-arc, end. */
    Points: [Point2D, Point2D, Point2D];
}

export interface CompositeCurveBody {
    Segments: Array<Polyline | CircularArc>;
}

export interface Position2D {
    Location?: Point2D;
}

export interface RectangleBody {
    position?: Position2D;
    Width: number;
    Height: number;
}

export interface CircleBody {
    position?: Position2D;
    Radius: number;
}

export interface IShapeBody {
    position?: Position2D;
    OverallWidth: number;
    OverallDepth: number;
    WebThickness: number;
    FlangeThickness: number;
    FilletRadius?: number;
}

export interface LShapeBody {
    position?: Position2D;
    Depth: number;
    Width: number;
    Thickness: number;
    FilletRadius?: number;
    EdgeRadius?: number;
}

export interface ProfileWithVoidsBody {
    exterior: Profile;
    Interior?: Profile[];
}

export interface CompositeProfileBody {
    Profiles: Profile[];
}

// --- Profile tag wrappers ---

export interface Polyline {
    "bsi::ifc::geometry::procedural::polyline": PolylineBody;
}

export interface CircularArc {
    "bsi::ifc::geometry::procedural::circular_arc": CircularArcBody;
}

export interface CompositeCurve {
    "bsi::ifc::geometry::procedural::composite_curve": CompositeCurveBody;
}

export interface Rectangle {
    "bsi::ifc::geometry::procedural::rectangle": RectangleBody;
}

export interface Circle {
    "bsi::ifc::geometry::procedural::circle": CircleBody;
}

export interface IShape {
    "bsi::ifc::geometry::procedural::i_shape": IShapeBody;
}

export interface LShape {
    "bsi::ifc::geometry::procedural::l_shape": LShapeBody;
}

export interface ProfileWithVoids {
    "bsi::ifc::geometry::procedural::profile_with_voids": ProfileWithVoidsBody;
}

export interface CompositeProfile {
    "bsi::ifc::geometry::procedural::composite_profile": CompositeProfileBody;
}

export type Profile =
    | Rectangle
    | Circle
    | IShape
    | LShape
    | Polyline
    | CompositeCurve
    | ProfileWithVoids
    | CompositeProfile;

// =============================================================================
// Tier P — Solid operations
// =============================================================================

export type Vector3 = [number, number, number];

export interface Axis2Placement3D {
    Location: Vector3;
    /** Local Z axis */
    Axis?: Vector3;
    /** Local X axis */
    RefDirection?: Vector3;
}

export interface ExtrudedAreaSolidBody {
    SweptArea: Profile;
    Position?: Axis2Placement3D;
    ExtrudedDirection: Vector3;
    Depth: number;
}

export interface RevolvedAreaSolidBody {
    SweptArea: Profile;
    Position?: Axis2Placement3D;
    AxisOrigin: Vector3;
    AxisDirection: Vector3;
    Angle: number;
}

export type BooleanOperator = "union" | "difference" | "intersection";

export interface BooleanResultBody {
    Operator: BooleanOperator;
    FirstOperand: ProceduralGeometry;
    SecondOperand: ProceduralGeometry;
}

export interface ExtrudedAreaSolid {
    "bsi::ifc::geometry::procedural::extruded_area_solid": ExtrudedAreaSolidBody;
}

export interface RevolvedAreaSolid {
    "bsi::ifc::geometry::procedural::revolved_area_solid": RevolvedAreaSolidBody;
}

export interface BooleanResult {
    "bsi::ifc::geometry::procedural::boolean_result": BooleanResultBody;
}

export type ProceduralGeometry = ExtrudedAreaSolid | RevolvedAreaSolid | BooleanResult;

// =============================================================================
// Tier M — Display mesh
// =============================================================================

export type MeshSourceTier = "procedural" | "brep";

/**
 * Maps a contiguous slice of `faceVertexIndices` back to the source face that
 * produced it. Present when the mesh was derived from a Brep — allows the
 * viewer to apply per-face materials authored on the composed face child node.
 */
export interface MeshFaceGroup {
    /** Start index in faceVertexIndices (multiple of 3) */
    start: number;
    /** Number of indices in this group (multiple of 3) */
    count: number;
    /** Position of the face in the assembled (in-memory) Brep faces[] array */
    faceIndex: number;
    /** Stable name of the source face child node (e.g. "Face_3") — the durable
     *  key a renderer uses to find the face node's own attributes. */
    faceName?: string;
}

export interface DisplayMesh {
    points: number[][];
    faceVertexIndices: number[];
    normals?: number[][];
    uvs?: number[][];
    /** Higher tier this mesh was derived from, if any. Absent means authored. */
    derivedFrom?: MeshSourceTier;
    /** Tessellation tolerance in source units */
    tolerance?: number;
    /** Stable content hash of the source-tier record (for cache validation) */
    sourceHash?: string;
    /** Triangle-range → source-face mapping; emitted by Tier B tessellation */
    faceGroups?: MeshFaceGroup[];
}

// =============================================================================
// Tier B — Native Brep (v1.1 minimal)
// =============================================================================

// --- Curve catalog ---

export interface LineCurveBody {
    Pnt: Vector3;
    Dir: Vector3;
}

export interface LineCurve {
    "bsi::ifc::geometry::brep::line": LineCurveBody;
}

export interface CircleCurveBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
    Radius: number;
}

export interface CircleCurve {
    "bsi::ifc::geometry::brep::circle": CircleCurveBody;
}

/**
 * Non-uniform rational B-spline curve.
 * Knot vector follows IFC IfcBSplineCurveWithKnots conventions:
 *   length(Knots) = number of distinct knots
 *   KnotMultiplicities[i] gives the multiplicity of Knots[i]
 *   total multiplicity = ControlPoints.length + Degree + 1
 * For uniform knot vectors KnotMultiplicities may be omitted (defaults to 1 per knot).
 */
export interface BSplineCurveBody {
    Degree: number;
    ControlPoints: Vector3[];
    Knots: number[];
    KnotMultiplicities?: number[];
    Weights?: number[];
    Closed?: boolean;
}

export interface BSplineCurve {
    "bsi::ifc::geometry::brep::bspline_curve": BSplineCurveBody;
}

export type BrepCurve = LineCurve | CircleCurve | BSplineCurve;

// --- Surface catalog ---

export interface PlanarSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
}

export interface PlanarSurface {
    "bsi::ifc::geometry::brep::plane": PlanarSurfaceBody;
}

export interface CylindricalSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
    Radius: number;
}
export interface CylindricalSurface {
    "bsi::ifc::geometry::brep::cylinder": CylindricalSurfaceBody;
}

export interface ConicalSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
    Radius: number;
    SemiAngle: number;
}
export interface ConicalSurface {
    "bsi::ifc::geometry::brep::cone": ConicalSurfaceBody;
}

export interface SphericalSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
    Radius: number;
}
export interface SphericalSurface {
    "bsi::ifc::geometry::brep::sphere": SphericalSurfaceBody;
}

export interface ToroidalSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
    MajorRadius: number;
    MinorRadius: number;
}
export interface ToroidalSurface {
    "bsi::ifc::geometry::brep::torus": ToroidalSurfaceBody;
}

/**
 * Non-uniform rational B-spline surface (tensor product).
 * ControlPoints[i][j] is the (u_i, v_j) point. Same i/j ↔ u/v ordering as IFC.
 */
export interface BSplineSurfaceBody {
    UDegree: number;
    VDegree: number;
    ControlPoints: Vector3[][];
    UKnots: number[];
    VKnots: number[];
    UKnotMultiplicities?: number[];
    VKnotMultiplicities?: number[];
    Weights?: number[][];
}
export interface BSplineSurface {
    "bsi::ifc::geometry::brep::bspline_surface": BSplineSurfaceBody;
}

export type BrepSurface =
    | PlanarSurface
    | CylindricalSurface
    | ConicalSurface
    | SphericalSurface
    | ToroidalSurface
    | BSplineSurface;

// --- Authored topology (identity-bearing nodes, referenced by relative path) ---
//
// This is the WIRE form: each primitive is a child node under the Brep body
// node, and one row of `ifcx.geom.brep.ndjson` is one of the *Node bodies
// below (validated by the `Brep` union schema). Cross-links are BrepRef relative
// paths (e.g. "<../Edge_3>"), resolved against the post-composition tree — never
// ordinal indices. The brep-assembler compiles these into the flat in-memory
// `Brep` further down; the brep-writer is the inverse.

/**
 * Path reference to another Brep topology node, wrapped in angle brackets
 * (USD relationship-target syntax). "../" ascends one segment relative to the
 * referencing node's path; a leading "/" is absolute. E.g. "<../Edge_3>".
 */
export type BrepRef = string;

/** Vertex node body. */
export interface BrepVertexNode {
    Point: Vector3;
}

/** Edge node body — a curve bounded by two vertex references. */
export interface BrepEdgeNode {
    /** Geometric carrier of the edge, inline (the edge *is* this curve). */
    Curve: BrepCurve;
    Start: BrepRef;
    End: BrepRef;
}

/** One oriented use of an edge within a loop. */
export interface BrepOrientedEdgeRef {
    Edge: BrepRef;
    Reversed: boolean;
}

/** Loop node body — an ordered cycle of oriented edge references. */
export interface BrepLoopNode {
    EdgeList: BrepOrientedEdgeRef[];
}

/** Face node body — a surface bounded by an outer loop and optional inner loops. */
export interface BrepFaceNode {
    /** Geometric carrier of the face, inline (the face *is* this surface). */
    Surface: BrepSurface;
    OuterLoop: BrepRef;
    InnerLoops?: BrepRef[];
    SameSense: boolean;
}

/** Shell node body — face references forming a (v1.1) closed manifold. */
export interface BrepShellNode {
    FaceList: BrepRef[];
}

/** Region node body — shell references; first is outer, rest are cavities (v1.2). */
export interface BrepRegionNode {
    ShellList: BrepRef[];
}

/** Brep body node — root of a Brep subtree; topology hangs off it as children. */
export interface BrepBodyNode {
    Tolerance?: number;
}

/**
 * Provenance for derived (e.g. boolean-output) topology. Cache-only attribute
 * `bsi::ifc::geometry::brep::derived_from` on a derived face node. Identity is
 * best-effort: stable within a kernel at a fixed tolerance, not across kernels.
 */
export interface BrepDerivedFrom {
    operation: BooleanOperator;
    /** References to the contributing input-face nodes */
    sources: BrepRef[];
}

/** Any one row of `ifcx.geom.brep.ndjson` — the body of a single topology node. */
export type BrepNodeBody =
    | BrepBodyNode
    | BrepVertexNode
    | BrepEdgeNode
    | BrepLoopNode
    | BrepFaceNode
    | BrepShellNode
    | BrepRegionNode;

// --- Compiled topology (private in-memory form, flat-indexed) ---
//
// NOT a wire format. Produced by the brep-assembler from the authored node tree
// (references resolved → array indices) and consumed by the tessellator and
// validator. Earlier drafts authored this directly; it is now derived/cache-only.

export interface BrepVertex {
    Point: Vector3;
}

export interface BrepEdge {
    CurveIndex: number;
    StartVertex: number;
    EndVertex: number;
}

export interface BrepOrientedEdge {
    EdgeIndex: number;
    Reversed: boolean;
}

export interface BrepLoop {
    EdgeList: BrepOrientedEdge[];
}

export interface BrepFace {
    SurfaceIndex: number;
    OuterLoop: number;
    InnerLoops?: number[];
    SameSense: boolean;
}

export interface BrepShell {
    FaceList: number[];
}

export interface BrepRegion {
    ShellList: number[];
}

/**
 * Compiled Brep — the in-memory result of assembling a Brep body subtree.
 * Flat-indexed for the tessellator; never serialized (the wire form is the
 * subtree of authored topology nodes above).
 */
export interface Brep {
    vertices: BrepVertex[];
    curves: BrepCurve[];
    surfaces: BrepSurface[];
    edges: BrepEdge[];
    loops: BrepLoop[];
    faces: BrepFace[];
    shells: BrepShell[];
    regions: BrepRegion[];
    Tolerance?: number;
}

// =============================================================================
// Tier B3 — External geometry reference (opaque, interop-only)
// =============================================================================

export type ExternalGeometryFormat =
    | "STEP_AP242"
    | "STEP_AP203"
    | "STEP_AP214"
    | "IFC_SPF"
    | "OCCT_BREP"
    | "PARASOLID_XT"
    | "JT"
    | "GLTF"
    | "OBJ"
    | "PLY";

export interface ExternalGeometryReference {
    format: ExternalGeometryFormat;
    uri: string;
    /** "<algo>-<hex>", e.g. "sha256-abcdef..." */
    integrity?: string;
    units?: string;
    tolerance?: number;
}

// =============================================================================
// Tier identifiers and table mapping
// =============================================================================

export type GeometryTier = "procedural" | "mesh" | "brep" | "external";

export const TIER_TABLE_NAMES: Record<GeometryTier, string> = {
    procedural: "ifcx.geom.proc",
    mesh: "ifcx.geom.mesh",
    brep: "ifcx.geom.brep",
    external: "ifcx.geom.ext",
};

// =============================================================================
// Tier P helpers
// =============================================================================

const PROC_TAGS = {
    extrudedAreaSolid: "bsi::ifc::geometry::procedural::extruded_area_solid",
    revolvedAreaSolid: "bsi::ifc::geometry::procedural::revolved_area_solid",
    booleanResult: "bsi::ifc::geometry::procedural::boolean_result",
} as const;

export function isExtrudedAreaSolid(p: ProceduralGeometry): p is ExtrudedAreaSolid {
    return PROC_TAGS.extrudedAreaSolid in p;
}

export function isRevolvedAreaSolid(p: ProceduralGeometry): p is RevolvedAreaSolid {
    return PROC_TAGS.revolvedAreaSolid in p;
}

export function isBooleanResult(p: ProceduralGeometry): p is BooleanResult {
    return PROC_TAGS.booleanResult in p;
}
