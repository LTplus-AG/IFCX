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
 * viewer to apply per-face materials authored via latent-path attributes.
 */
export interface MeshFaceGroup {
    /** Start index in faceVertexIndices (multiple of 3) */
    start: number;
    /** Number of indices in this group (multiple of 3) */
    count: number;
    /** Index into the source Brep's faces[] array */
    faceIndex: number;
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

export type BrepCurve = LineCurve | CircleCurve;

// --- Surface catalog ---

export interface PlanarSurfaceBody {
    Pnt: Vector3;
    Axis: Vector3;
    RefDirection: Vector3;
}

export interface PlanarSurface {
    "bsi::ifc::geometry::brep::plane": PlanarSurfaceBody;
}

export type BrepSurface = PlanarSurface;

// --- Topology ---

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
 * Tier B record. One Brep per row in ifcx.geom.brep.ndjson.
 *
 * Latent paths: when this Brep lives at IfcxNode path `P`, the following
 * sub-paths are addressable without authored child nodes — federated layers
 * may target them to attach per-face / per-edge / per-vertex attributes:
 *
 *   P/Face_<i>     i ∈ [0, faces.length)
 *   P/Edge_<i>     i ∈ [0, edges.length)
 *   P/Vertex_<i>   i ∈ [0, vertices.length)
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
// Latent-path helpers
// =============================================================================

const LATENT_FACE_RE = /^(.*)\/Face_(\d+)$/;
const LATENT_EDGE_RE = /^(.*)\/Edge_(\d+)$/;
const LATENT_VERTEX_RE = /^(.*)\/Vertex_(\d+)$/;

export interface LatentBrepPath {
    /** The IfcxNode path that owns the Brep */
    bodyPath: string;
    /** Which Brep sub-element kind the latent path addresses */
    kind: "face" | "edge" | "vertex";
    /** Zero-based index into Brep.faces / .edges / .vertices */
    index: number;
}

/**
 * Parse a latent Brep sub-element path. Returns null if `path` is not a Brep
 * latent path (e.g. it's a regular IfcxNode path). The caller is responsible
 * for verifying that `bodyPath` actually holds a Tier B Brep.
 */
export function parseLatentBrepPath(path: string): LatentBrepPath | null {
    let m = LATENT_FACE_RE.exec(path);
    if (m) return { bodyPath: m[1], kind: "face", index: parseInt(m[2], 10) };
    m = LATENT_EDGE_RE.exec(path);
    if (m) return { bodyPath: m[1], kind: "edge", index: parseInt(m[2], 10) };
    m = LATENT_VERTEX_RE.exec(path);
    if (m) return { bodyPath: m[1], kind: "vertex", index: parseInt(m[2], 10) };
    return null;
}

// =============================================================================
// Tier identifiers and table mapping
// =============================================================================

export type GeometryTier = "procedural" | "mesh" | "brep";

export const TIER_TABLE_NAMES: Record<GeometryTier, string> = {
    procedural: "ifcx.geom.proc",
    mesh: "ifcx.geom.mesh",
    brep: "ifcx.geom.brep",
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
