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
    BrepSurface,
    DisplayMesh,
    MeshFaceGroup,
    Point2D,
    Vector3,
    Profile,
    ProceduralGeometry,
    ExtrudedAreaSolidBody,
    RevolvedAreaSolidBody,
    isExtrudedAreaSolid,
    isRevolvedAreaSolid,
    isBooleanResult,
} from "./geometry-tiers";

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
    if (isExtrudedAreaSolid(geom)) {
        return tessellateExtrude(geom["bsi::ifc::geometry::procedural::extruded_area_solid"], opts);
    }
    if (isRevolvedAreaSolid(geom)) {
        return tessellateRevolve(geom["bsi::ifc::geometry::procedural::revolved_area_solid"], opts);
    }
    if (isBooleanResult(geom)) {
        return null;
    }
    return null;
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
// Walks each Brep face, samples its loop boundary into 3D points, projects to
// the surface's local 2D frame, triangulates with the shared earclip helpers,
// then maps triangles back to 3D. Each face emits its own vertex block so
// `geometry.computeVertexNormals()` produces flat per-face shading.
//
// v1.1 catalog: PlanarSurface only; LineCurve edges fully supported; CircleCurve
// edges degrade to straight-line chord between start/end vertices (proper arc
// sampling lands with v1.2 NURBS).

interface PlanarFrame {
    origin: Vector3;
    uAxis: Vector3;
    vAxis: Vector3;
    normal: Vector3;
}

export function tessellateBrep(brep: Brep, _opts: TessellateOptions = {}): DisplayMesh | null {
    if (!brep.faces || brep.faces.length === 0) return null;

    const points: number[][] = [];
    const faceVertexIndices: number[] = [];
    const faceGroups: MeshFaceGroup[] = [];

    for (let fi = 0; fi < brep.faces.length; fi++) {
        const face = brep.faces[fi];
        const surface = brep.surfaces[face.SurfaceIndex];
        const frame = planarSurfaceFrame(surface);
        if (!frame) continue;

        const outer3D = sampleLoop(brep, brep.loops[face.OuterLoop]);
        if (outer3D.length < 3) continue;
        const inner3D = (face.InnerLoops ?? [])
            .map(li => sampleLoop(brep, brep.loops[li]))
            .filter(loop => loop.length >= 3);

        const outer2D = outer3D.map(p => projectToFrame(p, frame));
        const inner2D = inner3D.map(loop => loop.map(p => projectToFrame(p, frame)));

        const outerCCW = ensureCCW(outer2D);
        const innerCW = inner2D.map(h => ensureCW(h));
        const tri = triangulate(outerCCW, innerCW);
        if (tri.indices.length === 0) continue;

        // Outward normal for this face (PlanarSurface.Axis flipped per SameSense)
        const outward: Vector3 = face.SameSense
            ? frame.normal
            : [-frame.normal[0], -frame.normal[1], -frame.normal[2]];

        // Per-face vertex block (no sharing across faces → flat shading via computeVertexNormals)
        const faceBase = points.length;
        for (let i = 0; i < tri.vertices.length; i += 2) {
            const p3d = unprojectFromFrame(tri.vertices[i], tri.vertices[i + 1], frame);
            points.push([p3d[0], p3d[1], p3d[2]]);
        }

        // Decide winding by checking the first triangle against the desired outward normal.
        // Flip all triangles for this face if it disagrees.
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
    };
}

const BREP_SURFACE_TAGS = {
    plane: "bsi::ifc::geometry::brep::plane",
} as const;

function planarSurfaceFrame(surface: BrepSurface): PlanarFrame | null {
    const planeBody = (surface as any)[BREP_SURFACE_TAGS.plane];
    if (!planeBody) return null;
    const origin: Vector3 = [planeBody.Pnt[0], planeBody.Pnt[1], planeBody.Pnt[2]];
    const normal = normalize([planeBody.Axis[0], planeBody.Axis[1], planeBody.Axis[2]]);
    let uAxis: Vector3 = normalize([
        planeBody.RefDirection[0],
        planeBody.RefDirection[1],
        planeBody.RefDirection[2],
    ]);
    // Re-orthogonalize uAxis against normal in case producer data isn't strictly orthonormal.
    const dotNU = uAxis[0] * normal[0] + uAxis[1] * normal[1] + uAxis[2] * normal[2];
    if (Math.abs(dotNU) > 1e-9) {
        uAxis = normalize([
            uAxis[0] - dotNU * normal[0],
            uAxis[1] - dotNU * normal[1],
            uAxis[2] - dotNU * normal[2],
        ]);
    }
    const vAxis = normalize(cross(normal, uAxis));
    return { origin, uAxis, vAxis, normal };
}

function projectToFrame(p: Vector3, frame: PlanarFrame): Point2D {
    const dx = p[0] - frame.origin[0];
    const dy = p[1] - frame.origin[1];
    const dz = p[2] - frame.origin[2];
    const u = dx * frame.uAxis[0] + dy * frame.uAxis[1] + dz * frame.uAxis[2];
    const v = dx * frame.vAxis[0] + dy * frame.vAxis[1] + dz * frame.vAxis[2];
    return [u, v];
}

function unprojectFromFrame(u: number, v: number, frame: PlanarFrame): Vector3 {
    return [
        frame.origin[0] + u * frame.uAxis[0] + v * frame.vAxis[0],
        frame.origin[1] + u * frame.uAxis[1] + v * frame.vAxis[1],
        frame.origin[2] + u * frame.uAxis[2] + v * frame.vAxis[2],
    ];
}

/**
 * Walk an edge loop, emit 3D points for each oriented edge's START vertex.
 * The END of the last edge equals the START of the first (closed loop), so we
 * don't duplicate the closing vertex. Edges currently degrade to straight chords
 * between start/end vertices regardless of curve type — v1.2 will sample arcs.
 */
function sampleLoop(brep: Brep, loop: BrepLoop): Vector3[] {
    const pts: Vector3[] = [];
    for (const oe of loop.EdgeList) {
        const edge = brep.edges[oe.EdgeIndex];
        const startIdx = oe.Reversed ? edge.EndVertex : edge.StartVertex;
        const sv = brep.vertices[startIdx];
        pts.push([sv.Point[0], sv.Point[1], sv.Point[2]]);
    }
    return pts;
}
