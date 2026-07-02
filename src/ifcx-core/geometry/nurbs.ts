// NURBS curve and surface evaluation.
// Cox-de Boor recursion for B-spline basis functions; rational evaluation via
// homogeneous control points / weight sums.

import { BSplineCurveBody, BSplineSurfaceBody, Vector3 } from "./geometry-tiers";

/**
 * Expand the schema's (Knots, KnotMultiplicities) pair into the full knot
 * vector used by the evaluation routines. If KnotMultiplicities is absent,
 * each knot has multiplicity 1.
 */
export function expandKnotVector(knots: number[], multiplicities?: number[]): number[] {
    if (!multiplicities) return knots.slice();
    if (multiplicities.length !== knots.length) {
        throw new Error(`NURBS: knots and multiplicities length mismatch (${knots.length} vs ${multiplicities.length})`);
    }
    const out: number[] = [];
    for (let i = 0; i < knots.length; i++) {
        const m = multiplicities[i];
        for (let k = 0; k < m; k++) out.push(knots[i]);
    }
    return out;
}

/**
 * Find the knot span containing parameter u: the largest i such that
 * knots[i] <= u < knots[i+1] (clamped at the upper boundary).
 */
function findKnotSpan(degree: number, knots: number[], u: number): number {
    const n = knots.length - degree - 2; // n = numControlPoints - 1
    if (u >= knots[n + 1]) return n;
    if (u <= knots[degree]) return degree;

    let lo = degree;
    let hi = n + 1;
    let mid = (lo + hi) >> 1;
    while (u < knots[mid] || u >= knots[mid + 1]) {
        if (u < knots[mid]) hi = mid;
        else lo = mid;
        mid = (lo + hi) >> 1;
    }
    return mid;
}

/**
 * Compute the (degree+1) non-zero basis functions at parameter u, returning
 * an array of length (degree+1) where result[i] = N_{span-degree+i, degree}(u).
 */
function basisFunctions(span: number, u: number, degree: number, knots: number[]): number[] {
    const N: number[] = new Array(degree + 1).fill(0);
    const left = new Array(degree + 1).fill(0);
    const right = new Array(degree + 1).fill(0);
    N[0] = 1;
    for (let j = 1; j <= degree; j++) {
        left[j] = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        let saved = 0;
        for (let r = 0; r < j; r++) {
            const temp = N[r] / (right[r + 1] + left[j - r]);
            N[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        N[j] = saved;
    }
    return N;
}

/** Evaluate a NURBS curve at parameter u. Returns a 3D point. */
export function evaluateBSplineCurve(body: BSplineCurveBody, u: number): Vector3 {
    const degree = body.Degree;
    const cps = body.ControlPoints;
    const knots = expandKnotVector(body.Knots, body.KnotMultiplicities);
    const weights = body.Weights;

    // Clamp u to [umin, umax]
    const umin = knots[degree];
    const umax = knots[knots.length - degree - 1];
    if (u < umin) u = umin;
    if (u > umax) u = umax;

    const span = findKnotSpan(degree, knots, u);
    const N = basisFunctions(span, u, degree, knots);

    // Homogeneous accumulation handles both rational and non-rational
    let x = 0, y = 0, z = 0, wsum = 0;
    for (let i = 0; i <= degree; i++) {
        const cp = cps[span - degree + i];
        const w = weights ? weights[span - degree + i] : 1;
        const Nw = N[i] * w;
        x += Nw * cp[0];
        y += Nw * cp[1];
        z += Nw * cp[2];
        wsum += Nw;
    }
    return [x / wsum, y / wsum, z / wsum];
}

/** Evaluate a NURBS surface at (u, v). Returns a 3D point. */
export function evaluateBSplineSurface(body: BSplineSurfaceBody, u: number, v: number): Vector3 {
    const p = body.UDegree;
    const q = body.VDegree;
    const cps = body.ControlPoints;
    const uKnots = expandKnotVector(body.UKnots, body.UKnotMultiplicities);
    const vKnots = expandKnotVector(body.VKnots, body.VKnotMultiplicities);
    const weights = body.Weights;

    // Clamp
    const uMin = uKnots[p], uMax = uKnots[uKnots.length - p - 1];
    const vMin = vKnots[q], vMax = vKnots[vKnots.length - q - 1];
    if (u < uMin) u = uMin;
    if (u > uMax) u = uMax;
    if (v < vMin) v = vMin;
    if (v > vMax) v = vMax;

    const uSpan = findKnotSpan(p, uKnots, u);
    const vSpan = findKnotSpan(q, vKnots, v);
    const Nu = basisFunctions(uSpan, u, p, uKnots);
    const Nv = basisFunctions(vSpan, v, q, vKnots);

    let x = 0, y = 0, z = 0, wsum = 0;
    for (let i = 0; i <= p; i++) {
        const uIdx = uSpan - p + i;
        for (let j = 0; j <= q; j++) {
            const vIdx = vSpan - q + j;
            const cp = cps[uIdx][vIdx];
            const w = weights ? weights[uIdx][vIdx] : 1;
            const Nuv = Nu[i] * Nv[j] * w;
            x += Nuv * cp[0];
            y += Nuv * cp[1];
            z += Nuv * cp[2];
            wsum += Nuv;
        }
    }
    return [x / wsum, y / wsum, z / wsum];
}

/**
 * Sample a NURBS curve into N+1 evenly-spaced points across the full
 * parameter range. Used by the Brep tessellator to discretize NURBS edges.
 */
export function sampleBSplineCurve(body: BSplineCurveBody, samples: number): Vector3[] {
    const degree = body.Degree;
    const knots = expandKnotVector(body.Knots, body.KnotMultiplicities);
    const uMin = knots[degree];
    const uMax = knots[knots.length - degree - 1];
    const points: Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const u = uMin + t * (uMax - uMin);
        points.push(evaluateBSplineCurve(body, u));
    }
    return points;
}

/**
 * Sample a NURBS curve between two parameter values uA, uB (inclusive of both
 * endpoints). For edges whose start/end vertices map to specific parameters
 * on the curve.
 */
export function sampleBSplineCurveRange(
    body: BSplineCurveBody,
    uA: number,
    uB: number,
    samples: number,
): Vector3[] {
    const points: Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const u = uA + t * (uB - uA);
        points.push(evaluateBSplineCurve(body, u));
    }
    return points;
}

/** Closest-parameter search on a NURBS curve via uniform-then-bisection refinement. */
export function findClosestParam(body: BSplineCurveBody, target: Vector3): number {
    const degree = body.Degree;
    const knots = expandKnotVector(body.Knots, body.KnotMultiplicities);
    const uMin = knots[degree];
    const uMax = knots[knots.length - degree - 1];

    // Coarse scan
    const coarseSteps = 32;
    let bestU = uMin;
    let bestD = Infinity;
    for (let i = 0; i <= coarseSteps; i++) {
        const u = uMin + (i / coarseSteps) * (uMax - uMin);
        const p = evaluateBSplineCurve(body, u);
        const dx = p[0] - target[0];
        const dy = p[1] - target[1];
        const dz = p[2] - target[2];
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
            bestD = d;
            bestU = u;
        }
    }

    // Local refinement via golden-section-like bisection
    const halfStep = (uMax - uMin) / coarseSteps;
    let lo = Math.max(uMin, bestU - halfStep);
    let hi = Math.min(uMax, bestU + halfStep);
    for (let iter = 0; iter < 24; iter++) {
        const a = lo + (hi - lo) / 3;
        const b = hi - (hi - lo) / 3;
        const pa = evaluateBSplineCurve(body, a);
        const pb = evaluateBSplineCurve(body, b);
        const da = (pa[0] - target[0]) ** 2 + (pa[1] - target[1]) ** 2 + (pa[2] - target[2]) ** 2;
        const db = (pb[0] - target[0]) ** 2 + (pb[1] - target[1]) ** 2 + (pb[2] - target[2]) ** 2;
        if (da < db) hi = b;
        else lo = a;
    }
    return (lo + hi) / 2;
}
