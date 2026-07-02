// Brep topology validator.
//
// IFCX v1.1+ allows non-manifold shells (open edges, laminar faces). This
// validator inspects a Brep's edge-face incidence counts and reports which
// topology category it falls into:
//
//   closed manifold     — every edge bounded by exactly two faces
//   open manifold       — at least one edge bounded by only one face (laminar)
//   non-manifold        — at least one edge bounded by three+ faces (spine)
//
// The tessellator doesn't fail on non-manifold input; per-face triangulation
// is independent and the result renders correctly. This validator exists so
// downstream tools (clash detection, FEA) can decide whether the geometry
// meets their requirements.

import { Brep } from "./geometry-tiers";

export type BrepManifoldKind = "closed_manifold" | "open_manifold" | "non_manifold" | "degenerate";

export interface BrepValidationReport {
    kind: BrepManifoldKind;
    edgeCount: number;
    /** Number of edges bounded by exactly one face. */
    laminarEdgeCount: number;
    /** Number of edges bounded by 3+ faces. */
    spineEdgeCount: number;
    /** Number of disconnected face components. */
    componentCount: number;
}

export function validateBrep(brep: Brep): BrepValidationReport {
    const edgeCount = brep.edges.length;
    if (edgeCount === 0 || brep.faces.length === 0) {
        return { kind: "degenerate", edgeCount, laminarEdgeCount: 0, spineEdgeCount: 0, componentCount: 0 };
    }

    // Count how many faces use each edge (via its loops' oriented edges).
    const edgeUseCount = new Array(edgeCount).fill(0);
    for (const face of brep.faces) {
        const loops = [face.OuterLoop, ...(face.InnerLoops ?? [])];
        for (const li of loops) {
            const loop = brep.loops[li];
            if (!loop) continue;
            for (const oe of loop.EdgeList) {
                if (oe.EdgeIndex >= 0 && oe.EdgeIndex < edgeCount) {
                    edgeUseCount[oe.EdgeIndex]++;
                }
            }
        }
    }

    let laminar = 0;
    let spine = 0;
    for (const c of edgeUseCount) {
        if (c === 1) laminar++;
        else if (c >= 3) spine++;
    }

    // Component count: union-find over faces that share an edge.
    const faceCount = brep.faces.length;
    const parent = new Array(faceCount).fill(0).map((_, i) => i);
    const find = (x: number): number => {
        while (parent[x] !== x) {
            parent[x] = parent[parent[x]];
            x = parent[x];
        }
        return x;
    };
    const union = (a: number, b: number) => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent[ra] = rb;
    };

    // Build edge → faceList map
    const edgeToFaces: number[][] = new Array(edgeCount).fill(null).map(() => []);
    for (let fi = 0; fi < faceCount; fi++) {
        const face = brep.faces[fi];
        const loops = [face.OuterLoop, ...(face.InnerLoops ?? [])];
        const seenInThisFace = new Set<number>();
        for (const li of loops) {
            const loop = brep.loops[li];
            if (!loop) continue;
            for (const oe of loop.EdgeList) {
                if (!seenInThisFace.has(oe.EdgeIndex)) {
                    edgeToFaces[oe.EdgeIndex].push(fi);
                    seenInThisFace.add(oe.EdgeIndex);
                }
            }
        }
    }
    for (const faces of edgeToFaces) {
        for (let i = 1; i < faces.length; i++) union(faces[0], faces[i]);
    }
    const roots = new Set<number>();
    for (let i = 0; i < faceCount; i++) roots.add(find(i));
    const componentCount = roots.size;

    let kind: BrepManifoldKind;
    if (spine > 0) kind = "non_manifold";
    else if (laminar > 0) kind = "open_manifold";
    else kind = "closed_manifold";

    return { kind, edgeCount, laminarEdgeCount: laminar, spineEdgeCount: spine, componentCount };
}
