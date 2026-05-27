// Tier P → Tier M tessellator.
//
// Pure TypeScript, no kernel dependency. Handles the v1 starter catalog:
//   ExtrudedAreaSolid, RevolvedAreaSolid (axis-aligned extrusions).
//   BooleanResult returns null in v1 (no CSG kernel).
//
// Profile boundary extraction: Rectangle, Circle, IShape, LShape, Polyline,
// CompositeCurve (with three-point arc sampling), ArbitraryClosed (via Polyline),
// ProfileWithVoids, CompositeProfile (uses first extrudable sub-profile).
//
// Triangulation: ear-clipping with hole-bridging. Suitable for simple AEC profiles.
// Not robust for self-intersecting, near-degenerate, or highly non-convex shapes.

import {
    Brep,
    BrepLoop,
    BrepCurve,
    BrepSurface,
    BSplineCurveBody,
    BSplineSurfaceBody,
    DisplayMesh,
    MeshFaceGroup,
    Point2D,
    Vector3,
    Profile,
    ProceduralGeometry,
    BooleanResultBody,
    ExtrudedAreaSolidBody,
    RevolvedAreaSolidBody,
    isExtrudedAreaSolid,
    isRevolvedAreaSolid,
    isBooleanResult,
} from "./geometry-tiers";
import {
    evaluateBSplineCurve,
    evaluateBSplineSurface,
    expandKnotVector,
    sampleBSplineCurve,
} from "./nurbs";
import { sourceHashOf } from "./source-hash";
import { csgUnion, csgSubtract, csgIntersect } from "./csg";

// =============================================================================
// Public entry
// =============================================================================

export interface TessellateOptions {
    /** Arc subdivision: number of samples per circular arc. Default 8. */
    arcSegments?: number;
    /** Circle subdivision: number of samples around a full circle. Default 32. */
    circleSegments?: number;
    /** Revolve subdivision: number of segments around the revolution axis. Default 24. */
    revolveSegments?: number;
}

export function tessellate(
    geom: ProceduralGeometry,
    opts: TessellateOptions = {},
): DisplayMesh | null {
    let mesh: DisplayMesh | null = null;
    if (isExtrudedAreaSolid(geom)) {
        mesh = tessellateExtrude(geom["bsi::ifc::geometry::procedural::extruded_area_solid"], opts);
    } else if (isRevolvedAreaSolid(geom)) {
        mesh = tessellateRevolve(geom["bsi::ifc::geometry::procedural::revolved_area_solid"], opts);
    } else if (isBooleanResult(geom)) {
        mesh = tessellateBoolean(geom["bsi::ifc::geometry::procedural::boolean_result"], opts);
    }
    if (mesh) {
        mesh.sourceHash = sourceHashOf(geom);
    }
    return mesh;
}

// =============================================================================
// Profile → boundary rings
// =============================================================================

interface Boundary {
    outer: Point2D[];
    holes: Point2D[][];
}

const PROFILE_TAGS = {
    rectangle: "bsi::ifc::geometry::procedural::rectangle",
    circle: "bsi::ifc::geometry::procedural::circle",
    iShape: "bsi::ifc::geometry::procedural::i_shape",
    lShape: "bsi::ifc::geometry::procedural::l_shape",
    polyline: "bsi::ifc::geometry::procedural::polyline",
    compositeCurve: "bsi::ifc::geometry::procedural::composite_curve",
    profileWithVoids: "bsi::ifc::geometry::procedural::profile_with_voids",
    compositeProfile: "bsi::ifc::geometry::procedural::composite_profile",
    circularArc: "bsi::ifc::geometry::procedural::circular_arc",
} as const;

function profileBoundary(profile: Profile, opts: TessellateOptions): Boundary | null {
    const k = Object.keys(profile)[0];
    const body = (profile as any)[k];

    switch (k) {
        case PROFILE_TAGS.rectangle:
            return { outer: rectangleOutline(body), holes: [] };
        case PROFILE_TAGS.circle:
            return { outer: circleOutline(body, opts.circleSegments ?? 32), holes: [] };
        case PROFILE_TAGS.iShape:
            return { outer: iShapeOutline(body), holes: [] };
        case PROFILE_TAGS.lShape:
            return { outer: lShapeOutline(body), holes: [] };
        case PROFILE_TAGS.polyline:
            return { outer: ensureCCW(body.Points.slice()), holes: [] };
        case PROFILE_TAGS.compositeCurve:
            return { outer: ensureCCW(sampleCompositeCurve(body, opts.arcSegments ?? 8)), holes: [] };
        case PROFILE_TAGS.profileWithVoids: {
            const ext = profileBoundary(body.exterior, opts);
            if (!ext) return null;
            const outer = ext.outer;
            const holes: Point2D[][] = [];
            for (const inner of body.Interior ?? []) {
                const innerB = profileBoundary(inner, opts);
                if (!innerB) continue;
                // Holes are CW (opposite winding from outer)
                holes.push(ensureCW(innerB.outer));
                for (const nestedHole of innerB.holes) {
                    holes.push(nestedHole);
                }
            }
            return { outer, holes };
        }
        case PROFILE_TAGS.compositeProfile: {
            // v1: take the first sub-profile that has a closed boundary
            for (const sub of body.Profiles ?? []) {
                const b = profileBoundary(sub, opts);
                if (b && b.outer.length >= 3) return b;
            }
            return null;
        }
        default:
            return null;
    }
}

function rectangleOutline(body: { position?: { Location?: Point2D }; Width: number; Height: number }): Point2D[] {
    const [cx, cy] = body.position?.Location ?? [0, 0];
    const hw = body.Width / 2;
    const hh = body.Height / 2;
    return [
        [cx - hw, cy - hh],
        [cx + hw, cy - hh],
        [cx + hw, cy + hh],
        [cx - hw, cy + hh],
    ];
}

function circleOutline(body: { position?: { Location?: Point2D }; Radius: number }, segments: number): Point2D[] {
    const [cx, cy] = body.position?.Location ?? [0, 0];
    const pts: Point2D[] = [];
    for (let i = 0; i < segments; i++) {
        const t = (i / segments) * 2 * Math.PI;
        pts.push([cx + body.Radius * Math.cos(t), cy + body.Radius * Math.sin(t)]);
    }
    return pts;
}

function iShapeOutline(body: { position?: { Location?: Point2D }; OverallWidth: number; OverallDepth: number; WebThickness: number; FlangeThickness: number }): Point2D[] {
    const [cx, cy] = body.position?.Location ?? [0, 0];
    const W = body.OverallWidth, D = body.OverallDepth;
    const tw = body.WebThickness, tf = body.FlangeThickness;
    const hw = W / 2, hd = D / 2, htw = tw / 2;
    return [
        [cx - hw, cy - hd],
        [cx + hw, cy - hd],
        [cx + hw, cy - hd + tf],
        [cx + htw, cy - hd + tf],
        [cx + htw, cy + hd - tf],
        [cx + hw, cy + hd - tf],
        [cx + hw, cy + hd],
        [cx - hw, cy + hd],
        [cx - hw, cy + hd - tf],
        [cx - htw, cy + hd - tf],
        [cx - htw, cy - hd + tf],
        [cx - hw, cy - hd + tf],
    ];
}

function lShapeOutline(body: { position?: { Location?: Point2D }; Depth: number; Width: number; Thickness: number }): Point2D[] {
    const [cx, cy] = body.position?.Location ?? [0, 0];
    const D = body.Depth, W = body.Width, t = body.Thickness;
    return [
        [cx, cy],
        [cx + W, cy],
        [cx + W, cy + t],
        [cx + t, cy + t],
        [cx + t, cy + D],
        [cx, cy + D],
    ];
}

function sampleCompositeCurve(body: { Segments: any[] }, arcSegments: number): Point2D[] {
    const out: Point2D[] = [];
    for (const seg of body.Segments ?? []) {
        const k = Object.keys(seg)[0];
        const sv = seg[k];
        if (k === PROFILE_TAGS.polyline) {
            for (const p of sv.Points) appendIfNew(out, p);
        } else if (k === PROFILE_TAGS.circularArc) {
            sampleThreePointArc(sv.Points, arcSegments, out);
        }
    }
    // Drop duplicate closing vertex
    if (out.length > 1 && pointsEqual(out[0], out[out.length - 1])) out.pop();
    return out;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
    return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function appendIfNew(out: Point2D[], p: Point2D): void {
    if (out.length === 0 || !pointsEqual(out[out.length - 1], p)) {
        out.push([p[0], p[1]]);
    }
}

function sampleThreePointArc(points: Point2D[], n: number, out: Point2D[]): void {
    const [p0, pm, p1] = points;
    const { cx, cy, r, aStart, ccw, sweep } = arcParams(p0, pm, p1);
    appendIfNew(out, p0);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const a = ccw ? aStart + sweep * t : aStart - sweep * t;
        appendIfNew(out, [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    appendIfNew(out, p1);
}

function arcParams(p0: Point2D, pm: Point2D, p1: Point2D) {
    const [x1, y1] = p0, [x2, y2] = pm, [x3, y3] = p1;
    const a = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2;
    const x1s = x1 * x1 + y1 * y1;
    const x2s = x2 * x2 + y2 * y2;
    const x3s = x3 * x3 + y3 * y3;
    const bx = x1s * (y2 - y3) + x2s * (y3 - y1) + x3s * (y1 - y2);
    const by = x1s * (x3 - x2) + x2s * (x1 - x3) + x3s * (x2 - x1);
    const cx = -bx / (2 * a);
    const cy = -by / (2 * a);
    const r = Math.hypot(x1 - cx, y1 - cy);
    const aStart = Math.atan2(y1 - cy, x1 - cx);
    const aMid = Math.atan2(y2 - cy, x2 - cx);
    const aEnd = Math.atan2(y3 - cy, x3 - cx);
    const norm = (t: number) => (t + 2 * Math.PI) % (2 * Math.PI);
    const dCCW = norm(aEnd - aStart);
    const onCCW = norm(aMid - aStart) <= dCCW;
    const ccw = onCCW;
    const sweep = ccw ? dCCW : norm(aStart - aEnd);
    return { cx, cy, r, aStart, ccw, sweep };
}

// =============================================================================
// Winding helpers
// =============================================================================

function signedArea(ring: Point2D[]): number {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return s / 2;
}

// signedArea > 0 → CCW (with the (x_{i-1} - x_i)(y_{i-1} + y_i) trapezoid sum).
function ensureCCW(ring: Point2D[]): Point2D[] {
    return signedArea(ring) < 0 ? ring.slice().reverse() : ring;
}

function ensureCW(ring: Point2D[]): Point2D[] {
    return signedArea(ring) > 0 ? ring.slice().reverse() : ring;
}

// =============================================================================
// Ear-clipping triangulation (with hole bridging)
// =============================================================================
//
// Inputs: outer (CCW) and holes (CW), each as Point2D[] without duplicate closing vertex.
// Output: { vertices: flat [x0,y0,x1,y1,...], indices: [i0,i1,i2,...] } where each
// triple of indices indexes into vertices and forms a CCW triangle.

interface Triangulation {
    vertices: number[];
    indices: number[];
}

function triangulate(outer: Point2D[], holes: Point2D[][]): Triangulation {
    // Flatten into a single ring by bridging each hole.
    const ring = bridgeHoles(outer, holes);
    const indices = earClip(ring);
    const vertices: number[] = [];
    for (const p of ring) {
        vertices.push(p[0], p[1]);
    }
    return { vertices, indices };
}

function bridgeHoles(outer: Point2D[], holes: Point2D[][]): Point2D[] {
    // Sort holes by descending rightmost x so the rightmost hole is bridged first.
    const ordered = holes
        .map(h => ({ pts: h, rightIdx: rightmostIndex(h) }))
        .sort((a, b) => b.pts[b.rightIdx][0] - a.pts[a.rightIdx][0]);

    let ring = outer.slice();
    for (const h of ordered) {
        ring = bridgeOneHole(ring, h.pts, h.rightIdx);
    }
    return ring;
}

function rightmostIndex(ring: Point2D[]): number {
    let idx = 0;
    for (let i = 1; i < ring.length; i++) {
        if (ring[i][0] > ring[idx][0]) idx = i;
    }
    return idx;
}

function bridgeOneHole(outer: Point2D[], hole: Point2D[], holeRightIdx: number): Point2D[] {
    const hp = hole[holeRightIdx];
    // Find an outer vertex visible from hp. Heuristic: rightward ray from hp hits an outer edge;
    // pick the edge's endpoint with the larger x.
    let bestIdx = -1;
    let bestX = -Infinity;
    let bestY = Infinity;
    for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        // Edge crosses the horizontal line y = hp[1]?
        if ((a[1] > hp[1]) === (b[1] > hp[1])) continue;
        // Compute edge x at y = hp[1]
        const t = (hp[1] - a[1]) / (b[1] - a[1]);
        const x = a[0] + t * (b[0] - a[0]);
        if (x <= hp[0]) continue;
        // Pick the endpoint with larger x (closer to interior side)
        const endpoint = a[0] >= b[0] ? i : (i + 1) % outer.length;
        const px = outer[endpoint][0];
        if (px < bestX) continue;
        if (px > bestX || outer[endpoint][1] < bestY) {
            bestX = px;
            bestY = outer[endpoint][1];
            bestIdx = endpoint;
        }
    }

    if (bestIdx < 0) {
        // Fallback: pick the outer vertex with maximum x
        bestIdx = rightmostIndex(outer);
    }

    // Construct the merged ring: outer[0..bestIdx], hole rotated starting at holeRightIdx,
    // hole[holeRightIdx] again, outer[bestIdx], outer[bestIdx+1..end]
    const merged: Point2D[] = [];
    for (let i = 0; i <= bestIdx; i++) merged.push(outer[i]);
    const n = hole.length;
    for (let i = 0; i < n; i++) {
        merged.push(hole[(holeRightIdx + i) % n]);
    }
    merged.push(hole[holeRightIdx]);
    merged.push(outer[bestIdx]);
    for (let i = bestIdx + 1; i < outer.length; i++) merged.push(outer[i]);
    return merged;
}

function earClip(ring: Point2D[]): number[] {
    const indices: number[] = [];
    const n = ring.length;
    if (n < 3) return indices;

    // Doubly-linked list of remaining indices
    const next = new Int32Array(n);
    const prev = new Int32Array(n);
    for (let i = 0; i < n; i++) {
        next[i] = (i + 1) % n;
        prev[i] = (i + n - 1) % n;
    }

    let remaining = n;
    let i = 0;
    let guard = 0;
    const guardMax = n * n + 100;

    while (remaining > 3 && guard++ < guardMax) {
        const a = prev[i], b = i, c = next[i];
        if (isEar(ring, a, b, c, next, prev)) {
            indices.push(a, b, c);
            next[a] = c;
            prev[c] = a;
            remaining--;
            i = a;
        } else {
            i = next[i];
        }
    }
    if (remaining === 3) {
        indices.push(prev[i], i, next[i]);
    }
    return indices;
}

function isEar(ring: Point2D[], a: number, b: number, c: number, next: Int32Array, prev: Int32Array): boolean {
    const ax = ring[a][0], ay = ring[a][1];
    const bx = ring[b][0], by = ring[b][1];
    const cx = ring[c][0], cy = ring[c][1];

    // Triangle must be CCW (convex corner at b)
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cross <= 0) return false;

    // No other vertex of the polygon may lie inside triangle abc
    let p = next[c];
    while (p !== a) {
        if (pointInTriangle(ring[p][0], ring[p][1], ax, ay, bx, by, cx, cy)) {
            return false;
        }
        p = next[p];
    }
    return true;
}

function pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
}

// =============================================================================
// 2D → 3D projection based on extrusion direction
// =============================================================================
//
// IFCX v1 convention without an explicit Position: the extrusion direction
// determines which axes the profile (u, v) maps to.
//   ExtrudedDirection ≈ [0, 0, ±1] → profile in world XY (u=X, v=Y)
//   ExtrudedDirection ≈ [0, ±1, 0] → profile in world XZ (u=X, v=Z)
//   ExtrudedDirection ≈ [±1, 0, 0] → profile in world YZ (u=Y, v=Z)
//   Non-axis-aligned → derive an orthonormal basis perpendicular to the direction.

interface Frame {
    /** Profile-u axis in world */
    u: Vector3;
    /** Profile-v axis in world */
    v: Vector3;
    /** Extrusion axis (normalized) */
    w: Vector3;
    /** +1 if (u, v, w) is right-handed (u×v = +w), -1 if left-handed (u×v = -w). */
    parity: 1 | -1;
}

function buildFrame(direction: Vector3): Frame {
    const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
    const w: Vector3 = [direction[0] / len, direction[1] / len, direction[2] / len];

    // Convention: profile-u maps to world's "horizontal" axis and profile-v maps to world's
    // "vertical" axis for the chosen extrusion. This matches how AEC authors lay out 2D profiles
    // (Width along world-X, Height along world-Z for a wall window, etc.). The resulting (u,v,w)
    // basis is right-handed for Z- and X-axis extrusion and *left-handed* for Y-axis extrusion;
    // the `parity` flag lets the tessellator flip triangle winding accordingly so outward normals
    // come out correctly.

    if (Math.abs(w[2]) > 0.99) {
        // Z-extrusion: profile in XY. u=X, v=±Y. u×v = ±Z = w → right-handed.
        return { u: [1, 0, 0], v: [0, w[2] > 0 ? 1 : -1, 0], w, parity: 1 };
    }
    if (Math.abs(w[1]) > 0.99) {
        // Y-extrusion: profile in XZ. u=X, v=±Z. u×v = ∓Y = -w → left-handed.
        return { u: [1, 0, 0], v: [0, 0, w[1] > 0 ? 1 : -1], w, parity: -1 };
    }
    if (Math.abs(w[0]) > 0.99) {
        // X-extrusion: profile in YZ. u=Y, v=±Z. u×v = ±X = w → right-handed.
        return { u: [0, 1, 0], v: [0, 0, w[0] > 0 ? 1 : -1], w, parity: 1 };
    }

    // Non-axis-aligned: derive right-handed basis via cross product.
    const tmp: Vector3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = normalize(cross(tmp, w));
    const v = normalize(cross(w, u));
    return { u, v, w, parity: 1 };
}

function cross(a: Vector3, b: Vector3): Vector3 {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function normalize(v: Vector3): Vector3 {
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function applyFrame(point2D: Point2D, frame: Frame, depthFraction: number, totalDepth: number): Vector3 {
    const offset = totalDepth * depthFraction;
    return [
        point2D[0] * frame.u[0] + point2D[1] * frame.v[0] + offset * frame.w[0],
        point2D[0] * frame.u[1] + point2D[1] * frame.v[1] + offset * frame.w[1],
        point2D[0] * frame.u[2] + point2D[1] * frame.v[2] + offset * frame.w[2],
    ];
}

// =============================================================================
// Extrude
// =============================================================================

function tessellateExtrude(body: ExtrudedAreaSolidBody, opts: TessellateOptions): DisplayMesh | null {
    const boundary = profileBoundary(body.SweptArea, opts);
    if (!boundary || boundary.outer.length < 3) return null;

    const outer = ensureCCW(boundary.outer);
    const holes = boundary.holes.map(h => ensureCW(h));
    const triangulation = triangulate(outer, holes);

    const frame = buildFrame(body.ExtrudedDirection);
    const depth = body.Depth;

    // Triangle emit helper that respects frame parity. Winding logic below is written assuming
    // a right-handed (u,v,w) frame; if the frame is left-handed (e.g., Y-extrusion under the
    // X→u, Z→v convention), the second and third indices are swapped so outward normals stay
    // outward.
    const points: number[][] = [];
    const faceVertexIndices: number[] = [];
    function tri(a: number, b: number, c: number) {
        if (frame.parity === 1) {
            faceVertexIndices.push(a, b, c);
        } else {
            faceVertexIndices.push(a, c, b);
        }
    }

    // Bottom cap: profile at depth 0, normal should face -w
    const bottomBase = 0;
    for (let i = 0; i < triangulation.vertices.length; i += 2) {
        const p = applyFrame(
            [triangulation.vertices[i], triangulation.vertices[i + 1]],
            frame, 0, depth,
        );
        points.push([p[0], p[1], p[2]]);
    }
    for (let i = 0; i < triangulation.indices.length; i += 3) {
        // CCW in profile (u,v) → normal +w for right-handed frame. Reverse to get -w (bottom).
        tri(
            bottomBase + triangulation.indices[i + 0],
            bottomBase + triangulation.indices[i + 2],
            bottomBase + triangulation.indices[i + 1],
        );
    }

    // Top cap: profile at depth = Depth, normal should face +w
    const topBase = points.length;
    for (let i = 0; i < triangulation.vertices.length; i += 2) {
        const p = applyFrame(
            [triangulation.vertices[i], triangulation.vertices[i + 1]],
            frame, 1, depth,
        );
        points.push([p[0], p[1], p[2]]);
    }
    for (let i = 0; i < triangulation.indices.length; i += 3) {
        tri(
            topBase + triangulation.indices[i + 0],
            topBase + triangulation.indices[i + 1],
            topBase + triangulation.indices[i + 2],
        );
    }

    // Side walls: walk every closed ring (outer CCW + holes CW), emit two triangles per edge.
    // The same winding pattern works for both: a CCW outer ring produces outward-facing
    // (away-from-interior) wall normals, and a CW hole ring produces wall normals that point
    // into the void (also away from material).
    //
    // Each wall edge gets its OWN 4-vertex block (no sharing with adjacent edges) so that
    // `geometry.computeVertexNormals()` produces flat per-face shading rather than averaging
    // perpendicular face normals at shared corners (which causes the "half dark / half light"
    // gradient on otherwise flat faces).
    const allRings: Point2D[][] = [outer, ...holes];
    for (const ring of allRings) {
        for (let i = 0; i < ring.length; i++) {
            const next = (i + 1) % ring.length;
            const wallBase = points.length;
            const p0 = applyFrame(ring[i], frame, 0, depth);
            const p1 = applyFrame(ring[next], frame, 0, depth);
            const p0t = applyFrame(ring[i], frame, 1, depth);
            const p1t = applyFrame(ring[next], frame, 1, depth);
            points.push([p0[0], p0[1], p0[2]]);   // wallBase + 0: bottom-i
            points.push([p1[0], p1[1], p1[2]]);   // wallBase + 1: bottom-next
            points.push([p0t[0], p0t[1], p0t[2]]); // wallBase + 2: top-i
            points.push([p1t[0], p1t[1], p1t[2]]); // wallBase + 3: top-next
            tri(wallBase + 0, wallBase + 1, wallBase + 3);
            tri(wallBase + 0, wallBase + 3, wallBase + 2);
        }
    }

    return {
        points,
        faceVertexIndices,
        derivedFrom: "procedural",
    };
}

// =============================================================================
// Revolve
// =============================================================================

function tessellateRevolve(body: RevolvedAreaSolidBody, opts: TessellateOptions): DisplayMesh | null {
    const boundary = profileBoundary(body.SweptArea, opts);
    if (!boundary || boundary.outer.length < 3) return null;

    const segments = opts.revolveSegments ?? 24;
    const outer = boundary.outer;
    const axisOrigin: Vector3 = [body.AxisOrigin[0], body.AxisOrigin[1], body.AxisOrigin[2]];
    const axisDir = normalize([body.AxisDirection[0], body.AxisDirection[1], body.AxisDirection[2]]);
    const angle = body.Angle;

    // Place profile in axis-aligned XY first, then revolve points around axis.
    // We lift each profile point to 3D using a frame where axis is "up" (Z analog).
    // For v1 simplicity, assume axis is Z-aligned and profile is in XY plane.
    // Non-Z axes are deferred.

    const isZ = Math.abs(axisDir[2]) > 0.99;
    if (!isZ) return null;

    const points: number[][] = [];
    const faceVertexIndices: number[] = [];

    // Sample (segments+1) rings of profile points around axis
    for (let s = 0; s <= segments; s++) {
        const t = (s / segments) * angle;
        const cos = Math.cos(t), sin = Math.sin(t);
        for (const p of outer) {
            // Profile point (u, v) becomes (u, 0, v) before revolution around Z
            const x = p[0] * cos - 0 * sin;
            const y = p[0] * sin + 0 * cos;
            const z = p[1];
            points.push([axisOrigin[0] + x, axisOrigin[1] + y, axisOrigin[2] + z]);
        }
    }

    // Build quad strips between consecutive rings
    const n = outer.length;
    for (let s = 0; s < segments; s++) {
        for (let i = 0; i < n; i++) {
            const i0 = s * n + i;
            const i1 = s * n + ((i + 1) % n);
            const i0n = (s + 1) * n + i;
            const i1n = (s + 1) * n + ((i + 1) % n);
            faceVertexIndices.push(i0, i1, i1n, i0, i1n, i0n);
        }
    }

    return {
        points,
        faceVertexIndices,
        derivedFrom: "procedural",
    };
}

// =============================================================================
// Tier B → Tier M tessellator
// =============================================================================
//
// Each face: sample its loop boundary in 3D (with proper arc / NURBS curve
// discretization), project to the surface's local (u, v) frame, triangulate
// with the shared earclip helpers, then evaluate each interior point back to
// 3D through the surface's evaluate(). Each face emits its own vertex block
// so `geometry.computeVertexNormals()` produces flat per-face shading on
// planar faces and per-triangle shading on curved faces.
//
// Surface catalog: PlanarSurface, CylindricalSurface, ConicalSurface,
// SphericalSurface, ToroidalSurface, BSplineSurface.
// Curve catalog: LineCurve, CircleCurve (arc-sampled), BSplineCurve.

const BREP_SURFACE_TAGS = {
    plane: "bsi::ifc::geometry::brep::plane",
    cylinder: "bsi::ifc::geometry::brep::cylinder",
    cone: "bsi::ifc::geometry::brep::cone",
    sphere: "bsi::ifc::geometry::brep::sphere",
    torus: "bsi::ifc::geometry::brep::torus",
    bsplineSurface: "bsi::ifc::geometry::brep::bspline_surface",
} as const;

const BREP_CURVE_TAGS = {
    line: "bsi::ifc::geometry::brep::line",
    circle: "bsi::ifc::geometry::brep::circle",
    bsplineCurve: "bsi::ifc::geometry::brep::bspline_curve",
} as const;

/**
 * Surface frame — abstracts uv ↔ 3D mapping for each surface type. The
 * tessellator works on any surface that implements this interface.
 */
interface SurfaceFrame {
    /** Project a 3D point onto the surface, returning its (u, v) coords. */
    projectToUV(p: Vector3): Point2D;
    /** Evaluate the surface at (u, v), returning a 3D point. */
    evaluate(u: number, v: number): Vector3;
    /** Outward normal at (u, v) (before SameSense flip). */
    normalAt(u: number, v: number): Vector3;
    /** True if the surface is locally non-planar — needs interior subdivision. */
    isCurved: boolean;
}

export function tessellateBrep(brep: Brep, opts: TessellateOptions = {}): DisplayMesh | null {
    if (!brep.faces || brep.faces.length === 0) return null;

    const points: number[][] = [];
    const faceVertexIndices: number[] = [];
    const faceGroups: MeshFaceGroup[] = [];

    for (let fi = 0; fi < brep.faces.length; fi++) {
        const face = brep.faces[fi];
        const surface = brep.surfaces[face.SurfaceIndex];
        const frame = buildSurfaceFrame(surface);
        if (!frame) continue;

        const outer3D = sampleLoop(brep, brep.loops[face.OuterLoop], opts);
        if (outer3D.length < 3) continue;
        const inner3D = (face.InnerLoops ?? [])
            .map(li => sampleLoop(brep, brep.loops[li], opts))
            .filter(loop => loop.length >= 3);

        const outer2D = outer3D.map(p => frame.projectToUV(p));
        const inner2D = inner3D.map(loop => loop.map(p => frame.projectToUV(p)));

        const outerCCW = ensureCCW(outer2D);
        const innerCW = inner2D.map(h => ensureCW(h));
        const tri = triangulate(outerCCW, innerCW);
        if (tri.indices.length === 0) continue;

        // Per-face vertex block (no sharing across faces → flat shading via computeVertexNormals)
        const faceBase = points.length;
        for (let i = 0; i < tri.vertices.length; i += 2) {
            const p3d = frame.evaluate(tri.vertices[i], tri.vertices[i + 1]);
            points.push([p3d[0], p3d[1], p3d[2]]);
        }

        // Outward normal: take from the first triangle's centroid (handles both planar
        // and curved surfaces). Flip per SameSense.
        const cu = (tri.vertices[2 * tri.indices[0]] + tri.vertices[2 * tri.indices[1]] + tri.vertices[2 * tri.indices[2]]) / 3;
        const cv = (tri.vertices[2 * tri.indices[0] + 1] + tri.vertices[2 * tri.indices[1] + 1] + tri.vertices[2 * tri.indices[2] + 1]) / 3;
        const surfNormal = frame.normalAt(cu, cv);
        const outward: Vector3 = face.SameSense
            ? surfNormal
            : [-surfNormal[0], -surfNormal[1], -surfNormal[2]];

        // Determine winding from the first triangle's geometric normal vs the desired outward.
        const a = points[faceBase + tri.indices[0]];
        const b = points[faceBase + tri.indices[1]];
        const c = points[faceBase + tri.indices[2]];
        const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
        const fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
        const nx = ey * fz - ez * fy;
        const ny = ez * fx - ex * fz;
        const nz = ex * fy - ey * fx;
        const flip = (nx * outward[0] + ny * outward[1] + nz * outward[2]) < 0;

        const groupStart = faceVertexIndices.length;
        for (let i = 0; i < tri.indices.length; i += 3) {
            if (!flip) {
                faceVertexIndices.push(
                    faceBase + tri.indices[i + 0],
                    faceBase + tri.indices[i + 1],
                    faceBase + tri.indices[i + 2],
                );
            } else {
                faceVertexIndices.push(
                    faceBase + tri.indices[i + 0],
                    faceBase + tri.indices[i + 2],
                    faceBase + tri.indices[i + 1],
                );
            }
        }
        faceGroups.push({ start: groupStart, count: faceVertexIndices.length - groupStart, faceIndex: fi });
    }

    if (faceVertexIndices.length === 0) return null;
    return {
        points,
        faceVertexIndices,
        derivedFrom: "brep",
        faceGroups,
        sourceHash: sourceHashOf(brep),
    };
}

// -- Surface frame factory ---------------------------------------------------

function buildSurfaceFrame(surface: BrepSurface): SurfaceFrame | null {
    const s = surface as any;
    if (s[BREP_SURFACE_TAGS.plane]) return planarFrame(s[BREP_SURFACE_TAGS.plane]);
    if (s[BREP_SURFACE_TAGS.cylinder]) return cylindricalFrame(s[BREP_SURFACE_TAGS.cylinder]);
    if (s[BREP_SURFACE_TAGS.cone]) return conicalFrame(s[BREP_SURFACE_TAGS.cone]);
    if (s[BREP_SURFACE_TAGS.sphere]) return sphericalFrame(s[BREP_SURFACE_TAGS.sphere]);
    if (s[BREP_SURFACE_TAGS.torus]) return toroidalFrame(s[BREP_SURFACE_TAGS.torus]);
    if (s[BREP_SURFACE_TAGS.bsplineSurface]) return bsplineSurfaceFrame(s[BREP_SURFACE_TAGS.bsplineSurface]);
    return null;
}

interface AxisFrame {
    origin: Vector3;
    axis: Vector3;     // local Z
    refDir: Vector3;   // local X (after orthogonalization)
    yDir: Vector3;     // local Y = axis × refDir
}

function axisFrameFromPlacement(Pnt: number[], Axis: number[], RefDirection: number[]): AxisFrame {
    const origin: Vector3 = [Pnt[0], Pnt[1], Pnt[2]];
    const axis = normalize([Axis[0], Axis[1], Axis[2]]);
    let refDir: Vector3 = normalize([RefDirection[0], RefDirection[1], RefDirection[2]]);
    const dotAR = refDir[0] * axis[0] + refDir[1] * axis[1] + refDir[2] * axis[2];
    if (Math.abs(dotAR) > 1e-9) {
        refDir = normalize([
            refDir[0] - dotAR * axis[0],
            refDir[1] - dotAR * axis[1],
            refDir[2] - dotAR * axis[2],
        ]);
    }
    const yDir = normalize(cross(axis, refDir));
    return { origin, axis, refDir, yDir };
}

function planarFrame(body: { Pnt: number[]; Axis: number[]; RefDirection: number[] }): SurfaceFrame {
    const f = axisFrameFromPlacement(body.Pnt, body.Axis, body.RefDirection);
    return {
        isCurved: false,
        projectToUV(p) {
            const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
            return [
                dx * f.refDir[0] + dy * f.refDir[1] + dz * f.refDir[2],
                dx * f.yDir[0] + dy * f.yDir[1] + dz * f.yDir[2],
            ];
        },
        evaluate(u, v) {
            return [
                f.origin[0] + u * f.refDir[0] + v * f.yDir[0],
                f.origin[1] + u * f.refDir[1] + v * f.yDir[1],
                f.origin[2] + u * f.refDir[2] + v * f.yDir[2],
            ];
        },
        normalAt() {
            return f.axis;
        },
    };
}

function cylindricalFrame(body: { Pnt: number[]; Axis: number[]; RefDirection: number[]; Radius: number }): SurfaceFrame {
    const f = axisFrameFromPlacement(body.Pnt, body.Axis, body.RefDirection);
    const R = body.Radius;
    return {
        isCurved: true,
        projectToUV(p) {
            // u = angle around axis from refDir, v = axial distance from origin
            const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
            const axialV = dx * f.axis[0] + dy * f.axis[1] + dz * f.axis[2];
            const proj: Vector3 = [
                dx - axialV * f.axis[0],
                dy - axialV * f.axis[1],
                dz - axialV * f.axis[2],
            ];
            const x = proj[0] * f.refDir[0] + proj[1] * f.refDir[1] + proj[2] * f.refDir[2];
            const y = proj[0] * f.yDir[0] + proj[1] * f.yDir[1] + proj[2] * f.yDir[2];
            return [Math.atan2(y, x), axialV];
        },
        evaluate(u, v) {
            const cos = Math.cos(u), sin = Math.sin(u);
            return [
                f.origin[0] + R * (cos * f.refDir[0] + sin * f.yDir[0]) + v * f.axis[0],
                f.origin[1] + R * (cos * f.refDir[1] + sin * f.yDir[1]) + v * f.axis[1],
                f.origin[2] + R * (cos * f.refDir[2] + sin * f.yDir[2]) + v * f.axis[2],
            ];
        },
        normalAt(u, _v) {
            const cos = Math.cos(u), sin = Math.sin(u);
            return normalize([
                cos * f.refDir[0] + sin * f.yDir[0],
                cos * f.refDir[1] + sin * f.yDir[1],
                cos * f.refDir[2] + sin * f.yDir[2],
            ]);
        },
    };
}

function conicalFrame(body: { Pnt: number[]; Axis: number[]; RefDirection: number[]; Radius: number; SemiAngle: number }): SurfaceFrame {
    const f = axisFrameFromPlacement(body.Pnt, body.Axis, body.RefDirection);
    const R0 = body.Radius;
    const tanA = Math.tan(body.SemiAngle);
    return {
        isCurved: true,
        projectToUV(p) {
            const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
            const axialV = dx * f.axis[0] + dy * f.axis[1] + dz * f.axis[2];
            const proj: Vector3 = [
                dx - axialV * f.axis[0],
                dy - axialV * f.axis[1],
                dz - axialV * f.axis[2],
            ];
            const x = proj[0] * f.refDir[0] + proj[1] * f.refDir[1] + proj[2] * f.refDir[2];
            const y = proj[0] * f.yDir[0] + proj[1] * f.yDir[1] + proj[2] * f.yDir[2];
            return [Math.atan2(y, x), axialV];
        },
        evaluate(u, v) {
            const r = R0 + v * tanA;
            const cos = Math.cos(u), sin = Math.sin(u);
            return [
                f.origin[0] + r * (cos * f.refDir[0] + sin * f.yDir[0]) + v * f.axis[0],
                f.origin[1] + r * (cos * f.refDir[1] + sin * f.yDir[1]) + v * f.axis[1],
                f.origin[2] + r * (cos * f.refDir[2] + sin * f.yDir[2]) + v * f.axis[2],
            ];
        },
        normalAt(u, _v) {
            // Normal lies in the meridian plane; rotated by the half-angle from the radial direction.
            const cos = Math.cos(u), sin = Math.sin(u);
            const radial: Vector3 = [
                cos * f.refDir[0] + sin * f.yDir[0],
                cos * f.refDir[1] + sin * f.yDir[1],
                cos * f.refDir[2] + sin * f.yDir[2],
            ];
            const cosA = Math.cos(body.SemiAngle);
            const sinA = Math.sin(body.SemiAngle);
            return normalize([
                cosA * radial[0] - sinA * f.axis[0],
                cosA * radial[1] - sinA * f.axis[1],
                cosA * radial[2] - sinA * f.axis[2],
            ]);
        },
    };
}

function sphericalFrame(body: { Pnt: number[]; Axis: number[]; RefDirection: number[]; Radius: number }): SurfaceFrame {
    const f = axisFrameFromPlacement(body.Pnt, body.Axis, body.RefDirection);
    const R = body.Radius;
    // (u = longitude around axis, v = latitude from refDir-equator, in [-π/2, π/2])
    return {
        isCurved: true,
        projectToUV(p) {
            const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
            const lat = Math.asin((dx * f.axis[0] + dy * f.axis[1] + dz * f.axis[2]) / R);
            const x = dx * f.refDir[0] + dy * f.refDir[1] + dz * f.refDir[2];
            const y = dx * f.yDir[0] + dy * f.yDir[1] + dz * f.yDir[2];
            const lon = Math.atan2(y, x);
            return [lon, lat];
        },
        evaluate(u, v) {
            const cosLat = Math.cos(v), sinLat = Math.sin(v);
            const cosLon = Math.cos(u), sinLon = Math.sin(u);
            return [
                f.origin[0] + R * (cosLat * (cosLon * f.refDir[0] + sinLon * f.yDir[0]) + sinLat * f.axis[0]),
                f.origin[1] + R * (cosLat * (cosLon * f.refDir[1] + sinLon * f.yDir[1]) + sinLat * f.axis[1]),
                f.origin[2] + R * (cosLat * (cosLon * f.refDir[2] + sinLon * f.yDir[2]) + sinLat * f.axis[2]),
            ];
        },
        normalAt(u, v) {
            const cosLat = Math.cos(v), sinLat = Math.sin(v);
            const cosLon = Math.cos(u), sinLon = Math.sin(u);
            return normalize([
                cosLat * (cosLon * f.refDir[0] + sinLon * f.yDir[0]) + sinLat * f.axis[0],
                cosLat * (cosLon * f.refDir[1] + sinLon * f.yDir[1]) + sinLat * f.axis[1],
                cosLat * (cosLon * f.refDir[2] + sinLon * f.yDir[2]) + sinLat * f.axis[2],
            ]);
        },
    };
}

function toroidalFrame(body: { Pnt: number[]; Axis: number[]; RefDirection: number[]; MajorRadius: number; MinorRadius: number }): SurfaceFrame {
    const f = axisFrameFromPlacement(body.Pnt, body.Axis, body.RefDirection);
    const Rm = body.MajorRadius;
    const r = body.MinorRadius;
    return {
        isCurved: true,
        projectToUV(p) {
            // u = angle around main axis, v = angle around tube
            const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
            const axialV = dx * f.axis[0] + dy * f.axis[1] + dz * f.axis[2];
            const px = dx * f.refDir[0] + dy * f.refDir[1] + dz * f.refDir[2];
            const py = dx * f.yDir[0] + dy * f.yDir[1] + dz * f.yDir[2];
            const u = Math.atan2(py, px);
            const rho = Math.sqrt(px * px + py * py);
            const v = Math.atan2(axialV, rho - Rm);
            return [u, v];
        },
        evaluate(u, v) {
            const cosU = Math.cos(u), sinU = Math.sin(u);
            const cosV = Math.cos(v), sinV = Math.sin(v);
            const rho = Rm + r * cosV;
            return [
                f.origin[0] + rho * (cosU * f.refDir[0] + sinU * f.yDir[0]) + r * sinV * f.axis[0],
                f.origin[1] + rho * (cosU * f.refDir[1] + sinU * f.yDir[1]) + r * sinV * f.axis[1],
                f.origin[2] + rho * (cosU * f.refDir[2] + sinU * f.yDir[2]) + r * sinV * f.axis[2],
            ];
        },
        normalAt(u, v) {
            const cosU = Math.cos(u), sinU = Math.sin(u);
            const cosV = Math.cos(v), sinV = Math.sin(v);
            return normalize([
                cosV * (cosU * f.refDir[0] + sinU * f.yDir[0]) + sinV * f.axis[0],
                cosV * (cosU * f.refDir[1] + sinU * f.yDir[1]) + sinV * f.axis[1],
                cosV * (cosU * f.refDir[2] + sinU * f.yDir[2]) + sinV * f.axis[2],
            ]);
        },
    };
}

function bsplineSurfaceFrame(body: BSplineSurfaceBody): SurfaceFrame {
    const uMin = expandKnotVector(body.UKnots, body.UKnotMultiplicities)[body.UDegree];
    const uMax = expandKnotVector(body.UKnots, body.UKnotMultiplicities);
    const uMaxV = uMax[uMax.length - body.UDegree - 1];
    const vMin = expandKnotVector(body.VKnots, body.VKnotMultiplicities)[body.VDegree];
    const vMax = expandKnotVector(body.VKnots, body.VKnotMultiplicities);
    const vMaxV = vMax[vMax.length - body.VDegree - 1];
    return {
        isCurved: true,
        projectToUV(p) {
            // Coarse-then-bisection inverse mapping over the (u, v) parameter rectangle.
            const steps = 16;
            let bestU = uMin, bestV = vMin, bestD = Infinity;
            for (let i = 0; i <= steps; i++) {
                for (let j = 0; j <= steps; j++) {
                    const u = uMin + (i / steps) * (uMaxV - uMin);
                    const v = vMin + (j / steps) * (vMaxV - vMin);
                    const q = evaluateBSplineSurface(body, u, v);
                    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
                    const d = dx * dx + dy * dy + dz * dz;
                    if (d < bestD) { bestD = d; bestU = u; bestV = v; }
                }
            }
            // Local refinement
            const uHalf = (uMaxV - uMin) / steps;
            const vHalf = (vMaxV - vMin) / steps;
            let uLo = Math.max(uMin, bestU - uHalf), uHi = Math.min(uMaxV, bestU + uHalf);
            let vLo = Math.max(vMin, bestV - vHalf), vHi = Math.min(vMaxV, bestV + vHalf);
            for (let iter = 0; iter < 18; iter++) {
                const uMid = (uLo + uHi) / 2, vMid = (vLo + vHi) / 2;
                const samples = [
                    [uMid - (uHi - uLo) / 4, vMid - (vHi - vLo) / 4],
                    [uMid + (uHi - uLo) / 4, vMid - (vHi - vLo) / 4],
                    [uMid - (uHi - uLo) / 4, vMid + (vHi - vLo) / 4],
                    [uMid + (uHi - uLo) / 4, vMid + (vHi - vLo) / 4],
                ];
                let bsi = 0, bsd = Infinity;
                for (let si = 0; si < 4; si++) {
                    const q = evaluateBSplineSurface(body, samples[si][0], samples[si][1]);
                    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
                    const d = dx * dx + dy * dy + dz * dz;
                    if (d < bsd) { bsd = d; bsi = si; }
                }
                const [bu, bv] = samples[bsi];
                uLo = bu - (uHi - uLo) / 4;
                uHi = bu + (uHi - uLo) / 4;
                vLo = bv - (vHi - vLo) / 4;
                vHi = bv + (vHi - vLo) / 4;
            }
            return [(uLo + uHi) / 2, (vLo + vHi) / 2];
        },
        evaluate(u, v) {
            return evaluateBSplineSurface(body, u, v);
        },
        normalAt(u, v) {
            // Approximate via finite differences in uv space
            const eps = 1e-4;
            const p = evaluateBSplineSurface(body, u, v);
            const pu = evaluateBSplineSurface(body, Math.min(uMaxV, u + eps), v);
            const pv = evaluateBSplineSurface(body, u, Math.min(vMaxV, v + eps));
            const du: Vector3 = [pu[0] - p[0], pu[1] - p[1], pu[2] - p[2]];
            const dv: Vector3 = [pv[0] - p[0], pv[1] - p[1], pv[2] - p[2]];
            return normalize(cross(du, dv));
        },
    };
}

// -- Loop & edge sampling ----------------------------------------------------

/**
 * Walk an edge loop, sampling each oriented edge into a polyline. For
 * LineCurve edges we emit just the start vertex (the chord is exact). For
 * CircleCurve and BSplineCurve edges we sample the curve between the start
 * and end vertices, so the loop polyline tracks the actual geometry.
 */
function sampleLoop(brep: Brep, loop: BrepLoop, opts: TessellateOptions): Vector3[] {
    const pts: Vector3[] = [];
    const arcSegs = opts.arcSegments ?? 12;
    for (const oe of loop.EdgeList) {
        const edge = brep.edges[oe.EdgeIndex];
        const startIdx = oe.Reversed ? edge.EndVertex : edge.StartVertex;
        const endIdx = oe.Reversed ? edge.StartVertex : edge.EndVertex;
        const sv = brep.vertices[startIdx];
        const ev = brep.vertices[endIdx];
        const sP: Vector3 = [sv.Point[0], sv.Point[1], sv.Point[2]];
        const eP: Vector3 = [ev.Point[0], ev.Point[1], ev.Point[2]];
        const curve = brep.curves[edge.CurveIndex] as any;

        if (curve[BREP_CURVE_TAGS.line]) {
            // LineCurve: chord is exact; emit start vertex only (end joins next edge's start).
            pts.push(sP);
            continue;
        }

        if (curve[BREP_CURVE_TAGS.circle]) {
            const circle = curve[BREP_CURVE_TAGS.circle];
            const samples = sampleCircleArcOnEdge(circle, sP, eP, arcSegs);
            // Emit every sample except the last (end vertex = next edge's start)
            for (let i = 0; i < samples.length - 1; i++) pts.push(samples[i]);
            continue;
        }

        if (curve[BREP_CURVE_TAGS.bsplineCurve]) {
            const bsp = curve[BREP_CURVE_TAGS.bsplineCurve];
            // For a NURBS edge, the start vertex maps to some parameter; sample N points.
            // v1: sample the full curve, then drop the tail that matches the edge's end.
            const samples = sampleBSplineCurve(bsp, arcSegs);
            for (let i = 0; i < samples.length - 1; i++) pts.push(samples[i]);
            continue;
        }

        // Unknown curve type — degrade to chord between vertices.
        pts.push(sP);
    }
    return pts;
}

/**
 * Sample a circular arc on a CircleCurve between two 3D vertex points that
 * lie on (or near) the circle. We project both onto the circle plane, find
 * their angles around the center, and sample N+1 points along the shorter
 * arc from start to end.
 */
function sampleCircleArcOnEdge(
    circle: { Pnt: number[]; Axis: number[]; RefDirection: number[]; Radius: number },
    start: Vector3,
    end: Vector3,
    segments: number,
): Vector3[] {
    const f = axisFrameFromPlacement(circle.Pnt, circle.Axis, circle.RefDirection);
    const R = circle.Radius;
    const angleOf = (p: Vector3) => {
        const dx = p[0] - f.origin[0], dy = p[1] - f.origin[1], dz = p[2] - f.origin[2];
        const x = dx * f.refDir[0] + dy * f.refDir[1] + dz * f.refDir[2];
        const y = dx * f.yDir[0] + dy * f.yDir[1] + dz * f.yDir[2];
        return Math.atan2(y, x);
    };
    const aStart = angleOf(start);
    const aEnd = angleOf(end);
    let sweep = aEnd - aStart;
    // Normalize sweep to (-π, π], picking the shorter direction
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const pts: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const a = aStart + t * sweep;
        const cos = Math.cos(a), sin = Math.sin(a);
        pts.push([
            f.origin[0] + R * (cos * f.refDir[0] + sin * f.yDir[0]),
            f.origin[1] + R * (cos * f.refDir[1] + sin * f.yDir[1]),
            f.origin[2] + R * (cos * f.refDir[2] + sin * f.yDir[2]),
        ]);
    }
    return pts;
}

// =============================================================================
// Boolean (CSG)
// =============================================================================

/**
 * Tessellate a BooleanResult by recursively tessellating both operands and
 * running the BSP-based CSG kernel. Returns null if either operand fails to
 * tessellate (e.g. nested BooleanResult that hits an unknown operation).
 */
function tessellateBoolean(body: BooleanResultBody, opts: TessellateOptions): DisplayMesh | null {
    const a = tessellate(body.FirstOperand, opts);
    const b = tessellate(body.SecondOperand, opts);
    if (!a || !b) return null;
    let result: DisplayMesh;
    switch (body.Operator) {
        case "union":
            result = csgUnion(a, b);
            break;
        case "difference":
            result = csgSubtract(a, b);
            break;
        case "intersection":
            result = csgIntersect(a, b);
            break;
        default:
            return null;
    }
    result.derivedFrom = "procedural";
    return result;
}
