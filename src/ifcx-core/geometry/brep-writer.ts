// Brep writer: serialize a flat in-memory `Brep` into authored topology nodes
// (a body node + one child per primitive) plus per-primitive ndjson rows wired
// by relative-path references. Inverse of brep-assembler.
//
// Primitives are named `<Kind>_<flatIndex>`; the flat index is a deterministic,
// content-ordered identity. For imported geometry without per-element GUIDs this
// is the documented best-effort identity.

import { Brep, BrepNodeBody } from "./geometry-tiers";
import { makeRef, nameOf } from "./brep-reference";

/** An index-file node as emitted by the writer (matches IndexFileNode shape). */
export interface BrepIndexNode {
    path: string;
    children?: { opinion: "VALUE"; name: string; value: string }[];
    attributes?: { opinion: "VALUE"; name: string; value: { typeID: string; componentIndex: number } }[];
}

export interface WriteBrepOptions {
    /** Path of the Brep body node; children are authored under it. */
    bodyPath: string;
    /** First component index this Brep's rows occupy in the brep table. */
    baseComponentIndex: number;
    /** Brep table type id; default "ifcx.geom.brep". */
    typeID?: string;
}

export interface WrittenBrep {
    /** Body node first, then one node per primitive. */
    nodes: BrepIndexNode[];
    /** ndjson rows in component-index order (row i is at baseComponentIndex + i). */
    rows: BrepNodeBody[];
}

/** Serialize a flat Brep into authored nodes + rows. */
export function writeBrep(brep: Brep, opts: WriteBrepOptions): WrittenBrep {
    const typeID = opts.typeID ?? "ifcx.geom.brep";
    const base = opts.baseComponentIndex;
    const bodyPath = opts.bodyPath;

    const rows: BrepNodeBody[] = [];
    const childNodes: BrepIndexNode[] = [];
    const bodyChildren: { opinion: "VALUE"; name: string; value: string }[] = [];

    const ref = (kind: Parameters<typeof nameOf>[0], i: number) => makeRef(`../${nameOf(kind, i)}`);

    const emit = (name: string, body: BrepNodeBody) => {
        const componentIndex = base + rows.length;
        rows.push(body);
        childNodes.push({
            path: `${bodyPath}/${name}`,
            attributes: [{ opinion: "VALUE", name: "ifcx::geom::brep", value: { typeID, componentIndex } }],
        });
        bodyChildren.push({ opinion: "VALUE", name, value: `${bodyPath}/${name}` });
    };

    brep.vertices.forEach((v, i) => emit(nameOf("vertex", i), { Point: v.Point }));

    brep.edges.forEach((e, i) => emit(nameOf("edge", i), {
        Curve: brep.curves[e.CurveIndex],
        Start: ref("vertex", e.StartVertex),
        End: ref("vertex", e.EndVertex),
    }));

    brep.loops.forEach((l, i) => emit(nameOf("loop", i), {
        EdgeList: l.EdgeList.map(oe => ({ Edge: ref("edge", oe.EdgeIndex), Reversed: oe.Reversed })),
    }));

    brep.faces.forEach((f, i) => {
        const body: BrepNodeBody = {
            Surface: brep.surfaces[f.SurfaceIndex],
            OuterLoop: ref("loop", f.OuterLoop),
            SameSense: f.SameSense,
        };
        if (f.InnerLoops && f.InnerLoops.length > 0) {
            (body as any).InnerLoops = f.InnerLoops.map(li => ref("loop", li));
        }
        emit(nameOf("face", i), body);
    });

    brep.shells.forEach((s, i) => emit(nameOf("shell", i), {
        FaceList: s.FaceList.map(fi => ref("face", fi)),
    }));

    brep.regions.forEach((r, i) => emit(nameOf("region", i), {
        ShellList: r.ShellList.map(si => ref("shell", si)),
    }));

    const bodyNode: BrepIndexNode = { path: bodyPath, children: bodyChildren };
    if (brep.Tolerance !== undefined) {
        const componentIndex = base + rows.length;
        rows.push({ Tolerance: brep.Tolerance });
        bodyNode.attributes = [{ opinion: "VALUE", name: "ifcx::geom::brep", value: { typeID, componentIndex } }];
    }

    return { nodes: [bodyNode, ...childNodes], rows };
}
