// STEP AP242 → IFCX Tier B converter.
//
// Reads cartesian_point / line / circle / direction / plane / vertex_point /
// edge_curve / oriented_edge / edge_loop / face_bound / face_outer_bound /
// advanced_face / closed_shell / manifold_solid_brep / b_spline_curve_with_knots
// / b_spline_surface_with_knots and converts to IFCX Tier B records.
//
// AP242 entity names are lowercase per ISO 10303-21 convention; the STEP21
// parser preserves them verbatim. Our extractor matches both lowercase (AP242)
// and uppercase (IFC) entity names so it can be reused for IFC4 Brep imports.

import {
    Brep,
    BrepCurve,
    BrepEdge,
    BrepFace,
    BrepLoop,
    BrepOrientedEdge,
    BrepRegion,
    BrepShell,
    BrepSurface,
    BrepVertex,
    Vector3,
} from "../geometry/geometry-tiers";
import {
    StepEntity,
    StepFile,
    StepValue,
    directionOf,
    numberOf,
    pointOf,
    resolveRef,
} from "./parser";

/** Convert every manifold_solid_brep / advanced_brep_shape_representation in the file to IFCX Brep. */
export function extractAp242Breps(file: StepFile): Brep[] {
    const breps: Brep[] = [];
    for (const ent of file.entities.values()) {
        const t = ent.type.toUpperCase();
        if (t === "MANIFOLD_SOLID_BREP" || t === "ADVANCED_BREP_SHAPE_REPRESENTATION") {
            const brep = convertManifoldSolidBrep(file, ent);
            if (brep) breps.push(brep);
        }
    }
    return breps;
}

interface BuildCtx {
    file: StepFile;
    vertexCache: Map<number, number>;  // STEP entity id → BrepVertex index
    curveCache: Map<number, number>;   // STEP entity id → BrepCurve index
    surfaceCache: Map<number, number>; // STEP entity id → BrepSurface index
    edgeCache: Map<number, number>;    // STEP entity id → BrepEdge index
    loopCache: Map<number, number>;    // STEP entity id → BrepLoop index
    brep: Brep;
}

function newCtx(file: StepFile): BuildCtx {
    return {
        file,
        vertexCache: new Map(),
        curveCache: new Map(),
        surfaceCache: new Map(),
        edgeCache: new Map(),
        loopCache: new Map(),
        brep: {
            vertices: [],
            curves: [],
            surfaces: [],
            edges: [],
            loops: [],
            faces: [],
            shells: [],
            regions: [],
        },
    };
}

function convertManifoldSolidBrep(file: StepFile, ent: StepEntity): Brep | null {
    const ctx = newCtx(file);
    // manifold_solid_brep: outer (closed_shell)
    const shellRef = ent.args[ent.args.length - 1];
    const shellEnt = resolveRef(file, shellRef);
    if (!shellEnt) return null;
    const shellIdx = convertShell(ctx, shellEnt);
    if (shellIdx < 0) return null;
    ctx.brep.regions.push({ ShellList: [shellIdx] });
    return ctx.brep;
}

function convertShell(ctx: BuildCtx, ent: StepEntity): number {
    // closed_shell / open_shell: cfs_faces (list of advanced_face)
    const facesArg = ent.args[ent.args.length - 1];
    if (facesArg.kind !== "list") return -1;
    const faceIndices: number[] = [];
    for (const faceRef of facesArg.items) {
        const faceEnt = resolveRef(ctx.file, faceRef);
        if (!faceEnt) continue;
        const fi = convertFace(ctx, faceEnt);
        if (fi >= 0) faceIndices.push(fi);
    }
    if (faceIndices.length === 0) return -1;
    const shellIdx = ctx.brep.shells.length;
    ctx.brep.shells.push({ FaceList: faceIndices });
    return shellIdx;
}

function convertFace(ctx: BuildCtx, ent: StepEntity): number {
    // advanced_face: bounds (list of face_bound), face_geometry (surface), same_sense (bool)
    const boundsArg = ent.args[ent.args.length - 3];
    const surfaceArg = ent.args[ent.args.length - 2];
    const sameSenseArg = ent.args[ent.args.length - 1];
    if (boundsArg.kind !== "list") return -1;

    let outerLoop = -1;
    const innerLoops: number[] = [];
    for (const boundRef of boundsArg.items) {
        const boundEnt = resolveRef(ctx.file, boundRef);
        if (!boundEnt) continue;
        // face_outer_bound / face_bound: bound (edge_loop), orientation (bool)
        const loopRef = boundEnt.args[boundEnt.args.length - 2];
        const loopEnt = resolveRef(ctx.file, loopRef);
        if (!loopEnt) continue;
        const li = convertLoop(ctx, loopEnt);
        if (li < 0) continue;
        if (boundEnt.type.toUpperCase() === "FACE_OUTER_BOUND" && outerLoop < 0) {
            outerLoop = li;
        } else {
            innerLoops.push(li);
        }
    }
    if (outerLoop < 0 && innerLoops.length > 0) {
        outerLoop = innerLoops.shift()!;
    }
    if (outerLoop < 0) return -1;

    const surfaceEnt = resolveRef(ctx.file, surfaceArg);
    const surfaceIdx = surfaceEnt ? cacheSurface(ctx, surfaceEnt) : -1;
    if (surfaceIdx < 0) return -1;

    const sameSense = sameSenseArg.kind === "enum"
        ? sameSenseArg.value.startsWith("T")
        : true;

    const face: BrepFace = {
        SurfaceIndex: surfaceIdx,
        OuterLoop: outerLoop,
        SameSense: sameSense,
    };
    if (innerLoops.length > 0) face.InnerLoops = innerLoops;
    const fi = ctx.brep.faces.length;
    ctx.brep.faces.push(face);
    return fi;
}

function convertLoop(ctx: BuildCtx, ent: StepEntity): number {
    if (ctx.loopCache.has(ent.id)) return ctx.loopCache.get(ent.id)!;
    // edge_loop: edge_list (list of oriented_edge)
    const listArg = ent.args[ent.args.length - 1];
    if (listArg.kind !== "list") return -1;
    const edges: BrepOrientedEdge[] = [];
    for (const oeRef of listArg.items) {
        const oeEnt = resolveRef(ctx.file, oeRef);
        if (!oeEnt) continue;
        // oriented_edge: edge_start ($ if derived), edge_end ($ if derived), edge_element, orientation
        const edgeRef = oeEnt.args[oeEnt.args.length - 2];
        const orientArg = oeEnt.args[oeEnt.args.length - 1];
        const edgeEnt = resolveRef(ctx.file, edgeRef);
        if (!edgeEnt) continue;
        const edgeIdx = cacheEdge(ctx, edgeEnt);
        if (edgeIdx < 0) continue;
        const orientation = orientArg.kind === "enum" ? orientArg.value.startsWith("T") : true;
        edges.push({ EdgeIndex: edgeIdx, Reversed: !orientation });
    }
    if (edges.length === 0) return -1;
    const li = ctx.brep.loops.length;
    ctx.brep.loops.push({ EdgeList: edges });
    ctx.loopCache.set(ent.id, li);
    return li;
}

function cacheEdge(ctx: BuildCtx, ent: StepEntity): number {
    if (ctx.edgeCache.has(ent.id)) return ctx.edgeCache.get(ent.id)!;
    // edge_curve: edge_start, edge_end, edge_geometry, same_sense
    const startEnt = resolveRef(ctx.file, ent.args[ent.args.length - 4]);
    const endEnt = resolveRef(ctx.file, ent.args[ent.args.length - 3]);
    const curveEnt = resolveRef(ctx.file, ent.args[ent.args.length - 2]);
    if (!startEnt || !endEnt || !curveEnt) return -1;
    const startIdx = cacheVertex(ctx, startEnt);
    const endIdx = cacheVertex(ctx, endEnt);
    const curveIdx = cacheCurve(ctx, curveEnt);
    if (startIdx < 0 || endIdx < 0 || curveIdx < 0) return -1;
    const ei = ctx.brep.edges.length;
    ctx.brep.edges.push({ CurveIndex: curveIdx, StartVertex: startIdx, EndVertex: endIdx });
    ctx.edgeCache.set(ent.id, ei);
    return ei;
}

function cacheVertex(ctx: BuildCtx, ent: StepEntity): number {
    if (ctx.vertexCache.has(ent.id)) return ctx.vertexCache.get(ent.id)!;
    // vertex_point: vertex_geometry (cartesian_point)
    const pointRef = ent.args[ent.args.length - 1];
    const point = pointOf(ctx.file, pointRef);
    if (!point) return -1;
    const vi = ctx.brep.vertices.length;
    ctx.brep.vertices.push({ Point: point });
    ctx.vertexCache.set(ent.id, vi);
    return vi;
}

function cacheCurve(ctx: BuildCtx, ent: StepEntity): number {
    if (ctx.curveCache.has(ent.id)) return ctx.curveCache.get(ent.id)!;
    const ci = ctx.brep.curves.length;
    const t = ent.type.toUpperCase();
    let curve: BrepCurve | null = null;
    if (t === "LINE") {
        // line: pnt (cartesian_point), dir (vector)
        const pnt = pointOf(ctx.file, ent.args[ent.args.length - 2]);
        const vecEnt = resolveRef(ctx.file, ent.args[ent.args.length - 1]);
        if (pnt && vecEnt) {
            // vector: orientation (direction), magnitude
            const dir = directionOf(ctx.file, vecEnt.args[vecEnt.args.length - 2]);
            if (dir) curve = { "bsi::ifc::geometry::brep::line": { Pnt: pnt, Dir: dir } };
        }
    } else if (t === "CIRCLE") {
        // circle: position (axis2_placement_3d), radius
        const placementEnt = resolveRef(ctx.file, ent.args[ent.args.length - 2]);
        const radius = numberOf(ent.args[ent.args.length - 1]);
        if (placementEnt) {
            const pnt = pointOf(ctx.file, placementEnt.args[placementEnt.args.length - 3]);
            const axis = directionOf(ctx.file, placementEnt.args[placementEnt.args.length - 2]);
            const refDir = directionOf(ctx.file, placementEnt.args[placementEnt.args.length - 1]);
            if (pnt && axis && refDir) {
                curve = {
                    "bsi::ifc::geometry::brep::circle": {
                        Pnt: pnt, Axis: axis, RefDirection: refDir, Radius: radius,
                    },
                };
            }
        }
    } else if (t === "B_SPLINE_CURVE_WITH_KNOTS" || t === "RATIONAL_B_SPLINE_CURVE_WITH_KNOTS") {
        // Simplified: degree, control_points_list, ..., knot_multiplicities, knots, ...
        // We pull the easy bits.
        const degree = numberOf(ent.args[ent.args.length - 8]);
        const cpsArg = ent.args[ent.args.length - 7];
        const multsArg = ent.args[ent.args.length - 3];
        const knotsArg = ent.args[ent.args.length - 2];
        if (cpsArg.kind === "list" && knotsArg.kind === "list" && Number.isFinite(degree)) {
            const cps: Vector3[] = [];
            for (const cpRef of cpsArg.items) {
                const p = pointOf(ctx.file, cpRef);
                if (p) cps.push(p);
            }
            const knots = knotsArg.items.map(numberOf);
            const mults = multsArg.kind === "list" ? multsArg.items.map(v => Math.round(numberOf(v))) : undefined;
            if (cps.length > 0) {
                curve = {
                    "bsi::ifc::geometry::brep::bspline_curve": {
                        Degree: degree,
                        ControlPoints: cps,
                        Knots: knots,
                        ...(mults ? { KnotMultiplicities: mults } : {}),
                    },
                };
            }
        }
    }
    if (!curve) return -1;
    ctx.brep.curves.push(curve);
    ctx.curveCache.set(ent.id, ci);
    return ci;
}

function cacheSurface(ctx: BuildCtx, ent: StepEntity): number {
    if (ctx.surfaceCache.has(ent.id)) return ctx.surfaceCache.get(ent.id)!;
    const si = ctx.brep.surfaces.length;
    const t = ent.type.toUpperCase();
    let surface: BrepSurface | null = null;

    if (t === "PLANE" || t === "IFCPLANE") {
        const placement = resolveRef(ctx.file, ent.args[ent.args.length - 1]);
        if (placement) {
            const pnt = pointOf(ctx.file, placement.args[placement.args.length - 3]);
            const axis = directionOf(ctx.file, placement.args[placement.args.length - 2]);
            const ref = directionOf(ctx.file, placement.args[placement.args.length - 1]);
            if (pnt && axis && ref) {
                surface = { "bsi::ifc::geometry::brep::plane": { Pnt: pnt, Axis: axis, RefDirection: ref } };
            }
        }
    } else if (t === "CYLINDRICAL_SURFACE") {
        // cylindrical_surface: position, radius
        const placement = resolveRef(ctx.file, ent.args[ent.args.length - 2]);
        const radius = numberOf(ent.args[ent.args.length - 1]);
        if (placement) {
            const pnt = pointOf(ctx.file, placement.args[placement.args.length - 3]);
            const axis = directionOf(ctx.file, placement.args[placement.args.length - 2]);
            const ref = directionOf(ctx.file, placement.args[placement.args.length - 1]);
            if (pnt && axis && ref) {
                surface = { "bsi::ifc::geometry::brep::cylinder": { Pnt: pnt, Axis: axis, RefDirection: ref, Radius: radius } };
            }
        }
    } else if (t === "SPHERICAL_SURFACE") {
        const placement = resolveRef(ctx.file, ent.args[ent.args.length - 2]);
        const radius = numberOf(ent.args[ent.args.length - 1]);
        if (placement) {
            const pnt = pointOf(ctx.file, placement.args[placement.args.length - 3]);
            const axis = directionOf(ctx.file, placement.args[placement.args.length - 2]);
            const ref = directionOf(ctx.file, placement.args[placement.args.length - 1]);
            if (pnt && axis && ref) {
                surface = { "bsi::ifc::geometry::brep::sphere": { Pnt: pnt, Axis: axis, RefDirection: ref, Radius: radius } };
            }
        }
    } else if (t === "CONICAL_SURFACE") {
        const placement = resolveRef(ctx.file, ent.args[ent.args.length - 3]);
        const radius = numberOf(ent.args[ent.args.length - 2]);
        const semiAngle = numberOf(ent.args[ent.args.length - 1]);
        if (placement) {
            const pnt = pointOf(ctx.file, placement.args[placement.args.length - 3]);
            const axis = directionOf(ctx.file, placement.args[placement.args.length - 2]);
            const ref = directionOf(ctx.file, placement.args[placement.args.length - 1]);
            if (pnt && axis && ref) {
                surface = { "bsi::ifc::geometry::brep::cone": { Pnt: pnt, Axis: axis, RefDirection: ref, Radius: radius, SemiAngle: semiAngle } };
            }
        }
    } else if (t === "TOROIDAL_SURFACE") {
        const placement = resolveRef(ctx.file, ent.args[ent.args.length - 3]);
        const major = numberOf(ent.args[ent.args.length - 2]);
        const minor = numberOf(ent.args[ent.args.length - 1]);
        if (placement) {
            const pnt = pointOf(ctx.file, placement.args[placement.args.length - 3]);
            const axis = directionOf(ctx.file, placement.args[placement.args.length - 2]);
            const ref = directionOf(ctx.file, placement.args[placement.args.length - 1]);
            if (pnt && axis && ref) {
                surface = { "bsi::ifc::geometry::brep::torus": { Pnt: pnt, Axis: axis, RefDirection: ref, MajorRadius: major, MinorRadius: minor } };
            }
        }
    }
    // b_spline_surface variants are complex; deferred.

    if (!surface) return -1;
    ctx.brep.surfaces.push(surface);
    ctx.surfaceCache.set(ent.id, si);
    return si;
}
