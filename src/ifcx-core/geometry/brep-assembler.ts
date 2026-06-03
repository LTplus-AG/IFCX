// Brep assembler: compile an authored Brep body subtree (topology child nodes
// wired by relative-path references) into the flat in-memory `Brep` the
// tessellator and validator consume. Inverse of brep-writer.
//
// All Brep topology references are SIBLING references under the body node
// (edges→vertices, loops→edges, faces→loops, shells→faces, regions→shells), so a
// reference "<../Edge_3>" resolves to the body's child named "Edge_3". We take
// the basename of the reference target as that sibling name.

import {
    Brep,
    BrepEdge,
    BrepFace,
    BrepLoop,
    BrepNodeBody,
    BrepOrientedEdge,
    BrepBodyNode,
    BrepVertexNode,
    BrepEdgeNode,
    BrepLoopNode,
    BrepFaceNode,
    BrepShellNode,
    BrepRegionNode,
} from "./geometry-tiers";
import { parseRef, kindOfName, kindOfBody, BrepTopoKind } from "./brep-reference";

/** One topology node as seen by the assembler. */
export interface AssemblerNode {
    /** Local child-name under the body (e.g. "Face_3") */
    name: string;
    /** Resolved attribute body (one row of ifcx.geom.brep.ndjson) */
    body: BrepNodeBody;
}

export interface AssemblerInput {
    /** Optional body-node body (carries Tolerance) */
    bodyBody?: BrepBodyNode;
    /** Topology child nodes of the body */
    children: AssemblerNode[];
}

export interface AssembledBrep {
    brep: Brep;
    /** faceNames[i] is the authored name of the face at brep.faces[i] */
    faceNames: string[];
}

/** Last path segment of a reference target — the sibling node name. */
function refSiblingName(ref: unknown): string {
    const inner = parseRef(ref);
    if (inner === null) throw new Error(`Brep assembler: expected a "<...>" reference, got ${JSON.stringify(ref)}`);
    const parts = inner.split("/").filter(p => p.length > 0 && p !== "." && p !== "..");
    const name = parts[parts.length - 1];
    if (!name) throw new Error(`Brep assembler: empty reference target "${inner}"`);
    return name;
}

function classify(node: AssemblerNode): BrepTopoKind {
    return kindOfName(node.name) ?? kindOfBody(node.body);
}

/** Assemble a Brep body subtree into the flat in-memory Brep + face name map. */
export function assembleBrep(input: AssemblerInput): AssembledBrep {
    const byKind: Record<BrepTopoKind, AssemblerNode[]> = {
        body: [], vertex: [], edge: [], loop: [], face: [], shell: [], region: [],
    };
    for (const node of input.children) byKind[classify(node)].push(node);

    const brep: Brep = {
        vertices: [], curves: [], surfaces: [], edges: [], loops: [], faces: [], shells: [], regions: [],
    };
    const faceNames: string[] = [];

    // vertices
    const vIndex = new Map<string, number>();
    for (const n of byKind.vertex) {
        vIndex.set(n.name, brep.vertices.length);
        brep.vertices.push({ Point: (n.body as BrepVertexNode).Point });
    }

    // edges (each inlines its curve → one curves[] entry)
    const eIndex = new Map<string, number>();
    const need = (m: Map<string, number>, name: string, kind: string, owner: string): number => {
        const i = m.get(name);
        if (i === undefined) throw new Error(`Brep assembler: ${owner} references unknown ${kind} "${name}"`);
        return i;
    };
    for (const n of byKind.edge) {
        const e = n.body as BrepEdgeNode;
        const ci = brep.curves.length;
        brep.curves.push(e.Curve);
        const edge: BrepEdge = {
            CurveIndex: ci,
            StartVertex: need(vIndex, refSiblingName(e.Start), "vertex", n.name),
            EndVertex: need(vIndex, refSiblingName(e.End), "vertex", n.name),
        };
        eIndex.set(n.name, brep.edges.length);
        brep.edges.push(edge);
    }

    // loops
    const lIndex = new Map<string, number>();
    for (const n of byKind.loop) {
        const l = n.body as BrepLoopNode;
        const edgeList: BrepOrientedEdge[] = l.EdgeList.map(oe => ({
            EdgeIndex: need(eIndex, refSiblingName(oe.Edge), "edge", n.name),
            Reversed: !!oe.Reversed,
        }));
        lIndex.set(n.name, brep.loops.length);
        brep.loops.push({ EdgeList: edgeList });
    }

    // faces (each inlines its surface → one surfaces[] entry)
    const fIndex = new Map<string, number>();
    for (const n of byKind.face) {
        const f = n.body as BrepFaceNode;
        const si = brep.surfaces.length;
        brep.surfaces.push(f.Surface);
        const face: BrepFace = {
            SurfaceIndex: si,
            OuterLoop: need(lIndex, refSiblingName(f.OuterLoop), "loop", n.name),
            SameSense: !!f.SameSense,
        };
        if (f.InnerLoops && f.InnerLoops.length > 0) {
            face.InnerLoops = f.InnerLoops.map(r => need(lIndex, refSiblingName(r), "loop", n.name));
        }
        fIndex.set(n.name, brep.faces.length);
        faceNames.push(n.name);
        brep.faces.push(face);
    }

    // shells
    const shIndex = new Map<string, number>();
    for (const n of byKind.shell) {
        const s = n.body as BrepShellNode;
        shIndex.set(n.name, brep.shells.length);
        brep.shells.push({ FaceList: s.FaceList.map(r => need(fIndex, refSiblingName(r), "face", n.name)) });
    }

    // regions
    for (const n of byKind.region) {
        const r = n.body as BrepRegionNode;
        brep.regions.push({ ShellList: r.ShellList.map(ref => need(shIndex, refSiblingName(ref), "shell", n.name)) });
    }

    if (input.bodyBody?.Tolerance !== undefined) brep.Tolerance = input.bodyBody.Tolerance;

    return { brep, faceNames };
}
