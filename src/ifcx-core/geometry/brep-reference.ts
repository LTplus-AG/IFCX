// Brep topology references and primitive-kind classification.
//
// A reference is a string "<P>" (USD relationship-target syntax) where P is a
// path resolved against the referencing node's path. See ResolveRelative in
// ../composition/path. Topology nodes are named `<Kind>_<id>`; the kind is the
// classification used by the assembler/writer.

import { ResolveRelative } from "../composition/path";
import { BrepNodeBody } from "./geometry-tiers";

export type BrepTopoKind = "body" | "vertex" | "edge" | "loop" | "face" | "shell" | "region";

const REF_RE = /^<(.+)>$/;

/** Wrap a path as a reference value: "a/b" → "<a/b>". */
export function makeRef(path: string): string {
    return `<${path}>`;
}

/** True if `v` is a "<...>" reference string. */
export function isRef(v: unknown): v is string {
    return typeof v === "string" && REF_RE.test(v);
}

/** Inner path of a "<...>" reference, or null if `v` is not a reference. */
export function parseRef(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const m = REF_RE.exec(v);
    return m ? m[1] : null;
}

/**
 * Resolve a "<...>" reference carried by a node at `basePath` to an absolute
 * (root-relative) node path. Returns null if `v` is not a reference.
 */
export function resolveRef(basePath: string, v: unknown): string | null {
    const inner = parseRef(v);
    if (inner === null) return null;
    return ResolveRelative(basePath, inner);
}

const KIND_PREFIXES: ReadonlyArray<[string, BrepTopoKind]> = [
    ["Vertex_", "vertex"],
    ["Edge_", "edge"],
    ["Loop_", "loop"],
    ["Face_", "face"],
    ["Shell_", "shell"],
    ["Region_", "region"],
];

/** Classify a topology node by its child-name prefix (`Face_3` → "face"). */
export function kindOfName(name: string): BrepTopoKind | null {
    for (const [prefix, kind] of KIND_PREFIXES) {
        if (name.startsWith(prefix)) return kind;
    }
    return null;
}

/** Stable child-name for a primitive of `kind` with identity `id` (`face`,`3` → "Face_3"). */
export function nameOf(kind: BrepTopoKind, id: string | number): string {
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    return `${cap}_${id}`;
}

/**
 * Classify a brep table row by its shape — the fallback when the node name is
 * not a `<Kind>_<id>` convention name (e.g. a body node named "Body").
 */
export function kindOfBody(body: BrepNodeBody): BrepTopoKind {
    const b = body as Record<string, unknown>;
    if ("Point" in b) return "vertex";
    if ("Curve" in b && "Start" in b) return "edge";
    if ("EdgeList" in b) return "loop";
    if ("Surface" in b && "OuterLoop" in b) return "face";
    if ("FaceList" in b) return "shell";
    if ("ShellList" in b) return "region";
    return "body";
}
