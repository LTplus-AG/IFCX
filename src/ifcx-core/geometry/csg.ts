// BSP-based mesh CSG. Pure TypeScript, no kernel dependency.
//
// Adapted from the textbook BSP-CSG algorithm (Naylor / Amanatides / Thibault;
// implemented in Evan Wallace's csg.js, MIT). Operations:
//   union(A, B)        — points in A ∪ B
//   subtract(A, B)     — points in A \ B
//   intersect(A, B)    — points in A ∩ B
//
// Input meshes must be closed and reasonably manifold for the result to be
// well-defined. Open shells produce undefined results.

import { DisplayMesh, Vector3 } from "./geometry-tiers";

const EPSILON = 1e-5;

class Plane {
    constructor(public normal: Vector3, public w: number) { }

    static fromPoints(a: Vector3, b: Vector3, c: Vector3): Plane | null {
        const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
        const cax = c[0] - a[0], cay = c[1] - a[1], caz = c[2] - a[2];
        let nx = bay * caz - baz * cay;
        let ny = baz * cax - bax * caz;
        let nz = bax * cay - bay * cax;
        const len = Math.hypot(nx, ny, nz);
        if (len < EPSILON) return null;
        nx /= len; ny /= len; nz /= len;
        const w = nx * a[0] + ny * a[1] + nz * a[2];
        return new Plane([nx, ny, nz], w);
    }

    flip(): void {
        this.normal[0] = -this.normal[0];
        this.normal[1] = -this.normal[1];
        this.normal[2] = -this.normal[2];
        this.w = -this.w;
    }

    /**
     * Split a polygon against this plane, distributing pieces into front/back
     * lists. Coplanar pieces go to coplanarFront or coplanarBack based on
     * normal alignment.
     */
    splitPolygon(
        polygon: Polygon,
        coplanarFront: Polygon[],
        coplanarBack: Polygon[],
        front: Polygon[],
        back: Polygon[],
    ): void {
        const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
        let polygonType = 0;
        const types: number[] = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
            const t = this.normal[0] * polygon.vertices[i][0]
                    + this.normal[1] * polygon.vertices[i][1]
                    + this.normal[2] * polygon.vertices[i][2]
                    - this.w;
            const type = t < -EPSILON ? BACK : t > EPSILON ? FRONT : COPLANAR;
            polygonType |= type;
            types.push(type);
        }

        switch (polygonType) {
            case COPLANAR: {
                const dot = this.normal[0] * polygon.plane.normal[0]
                          + this.normal[1] * polygon.plane.normal[1]
                          + this.normal[2] * polygon.plane.normal[2];
                (dot > 0 ? coplanarFront : coplanarBack).push(polygon);
                break;
            }
            case FRONT:
                front.push(polygon);
                break;
            case BACK:
                back.push(polygon);
                break;
            case SPANNING: {
                const f: Vector3[] = [];
                const b: Vector3[] = [];
                for (let i = 0; i < polygon.vertices.length; i++) {
                    const j = (i + 1) % polygon.vertices.length;
                    const ti = types[i], tj = types[j];
                    const vi = polygon.vertices[i], vj = polygon.vertices[j];
                    if (ti !== BACK) f.push(vi);
                    if (ti !== FRONT) b.push(ti !== BACK ? [vi[0], vi[1], vi[2]] : vi);
                    if ((ti | tj) === SPANNING) {
                        const t = (this.w - (this.normal[0] * vi[0] + this.normal[1] * vi[1] + this.normal[2] * vi[2]))
                                / (this.normal[0] * (vj[0] - vi[0]) + this.normal[1] * (vj[1] - vi[1]) + this.normal[2] * (vj[2] - vi[2]));
                        const v: Vector3 = [
                            vi[0] + t * (vj[0] - vi[0]),
                            vi[1] + t * (vj[1] - vi[1]),
                            vi[2] + t * (vj[2] - vi[2]),
                        ];
                        f.push(v);
                        b.push([v[0], v[1], v[2]]);
                    }
                }
                if (f.length >= 3) front.push(new Polygon(f));
                if (b.length >= 3) back.push(new Polygon(b));
                break;
            }
        }
    }
}

class Polygon {
    plane: Plane;
    constructor(public vertices: Vector3[]) {
        // Derive plane from first three non-collinear vertices.
        let p: Plane | null = null;
        for (let i = 2; i < vertices.length; i++) {
            p = Plane.fromPoints(vertices[0], vertices[1], vertices[i]);
            if (p) break;
        }
        // Degenerate polygon — give it a sentinel plane so it gets skipped downstream.
        this.plane = p ?? new Plane([0, 0, 1], 0);
    }

    flip(): void {
        this.vertices.reverse();
        this.plane.flip();
    }

    clone(): Polygon {
        const cloned = new Polygon(this.vertices.map(v => [v[0], v[1], v[2]] as Vector3));
        cloned.plane = new Plane(
            [this.plane.normal[0], this.plane.normal[1], this.plane.normal[2]],
            this.plane.w,
        );
        return cloned;
    }
}

class BSPNode {
    plane: Plane | null = null;
    front: BSPNode | null = null;
    back: BSPNode | null = null;
    polygons: Polygon[] = [];

    constructor(polygons?: Polygon[]) {
        if (polygons && polygons.length > 0) {
            this.build(polygons);
        }
    }

    /** Build (or extend) a BSP tree from a list of polygons. */
    build(polygons: Polygon[]): void {
        if (polygons.length === 0) return;
        if (!this.plane) this.plane = new Plane(
            [polygons[0].plane.normal[0], polygons[0].plane.normal[1], polygons[0].plane.normal[2]],
            polygons[0].plane.w,
        );
        const front: Polygon[] = [];
        const back: Polygon[] = [];
        for (const p of polygons) {
            this.plane.splitPolygon(p, this.polygons, this.polygons, front, back);
        }
        if (front.length > 0) {
            if (!this.front) this.front = new BSPNode();
            this.front.build(front);
        }
        if (back.length > 0) {
            if (!this.back) this.back = new BSPNode();
            this.back.build(back);
        }
    }

    /** Recursively flip every polygon and plane (swap inside / outside). */
    invert(): void {
        for (const p of this.polygons) p.flip();
        if (this.plane) this.plane.flip();
        if (this.front) this.front.invert();
        if (this.back) this.back.invert();
        const tmp = this.front;
        this.front = this.back;
        this.back = tmp;
    }

    /** Remove parts of `polygons` that lie inside this BSP. */
    clipPolygons(polygons: Polygon[]): Polygon[] {
        if (!this.plane) return polygons.slice();
        let front: Polygon[] = [];
        let back: Polygon[] = [];
        for (const p of polygons) {
            this.plane.splitPolygon(p, front, back, front, back);
        }
        if (this.front) front = this.front.clipPolygons(front);
        if (this.back) back = this.back.clipPolygons(back);
        else back = [];
        return front.concat(back);
    }

    /** Remove the parts of this BSP that lie inside `bsp`. */
    clipTo(bsp: BSPNode): void {
        this.polygons = bsp.clipPolygons(this.polygons);
        if (this.front) this.front.clipTo(bsp);
        if (this.back) this.back.clipTo(bsp);
    }

    allPolygons(): Polygon[] {
        let out = this.polygons.slice();
        if (this.front) out = out.concat(this.front.allPolygons());
        if (this.back) out = out.concat(this.back.allPolygons());
        return out;
    }
}

// -- Mesh ↔ Polygon[] conversion --------------------------------------------

function meshToPolygons(mesh: DisplayMesh): Polygon[] {
    const polys: Polygon[] = [];
    const idx = mesh.faceVertexIndices;
    const pts = mesh.points;
    for (let i = 0; i < idx.length; i += 3) {
        const a = pts[idx[i]];
        const b = pts[idx[i + 1]];
        const c = pts[idx[i + 2]];
        if (!a || !b || !c) continue;
        const p = new Polygon([
            [a[0], a[1], a[2]],
            [b[0], b[1], b[2]],
            [c[0], c[1], c[2]],
        ]);
        // Reject degenerate triangles whose plane couldn't be determined.
        const n = p.plane.normal;
        if (Math.hypot(n[0], n[1], n[2]) > 0.5) polys.push(p);
    }
    return polys;
}

function polygonsToMesh(polys: Polygon[]): DisplayMesh {
    // CSG result polygons may be quads or larger; fan-triangulate each.
    const points: number[][] = [];
    const faceVertexIndices: number[] = [];
    for (const poly of polys) {
        const baseIdx = points.length;
        for (const v of poly.vertices) points.push([v[0], v[1], v[2]]);
        // Fan triangulation around vertex 0
        for (let i = 1; i < poly.vertices.length - 1; i++) {
            faceVertexIndices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
        }
    }
    return { points, faceVertexIndices };
}

// -- Public operations -------------------------------------------------------

export function csgUnion(a: DisplayMesh, b: DisplayMesh): DisplayMesh {
    const A = new BSPNode(meshToPolygons(a));
    const B = new BSPNode(meshToPolygons(b));
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.allPolygons());
    return polygonsToMesh(A.allPolygons());
}

export function csgSubtract(a: DisplayMesh, b: DisplayMesh): DisplayMesh {
    const A = new BSPNode(meshToPolygons(a));
    const B = new BSPNode(meshToPolygons(b));
    A.invert();
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.allPolygons());
    A.invert();
    return polygonsToMesh(A.allPolygons());
}

export function csgIntersect(a: DisplayMesh, b: DisplayMesh): DisplayMesh {
    const A = new BSPNode(meshToPolygons(a));
    const B = new BSPNode(meshToPolygons(b));
    A.invert();
    B.clipTo(A);
    B.invert();
    A.clipTo(B);
    B.clipTo(A);
    A.build(B.allPolygons());
    A.invert();
    return polygonsToMesh(A.allPolygons());
}
