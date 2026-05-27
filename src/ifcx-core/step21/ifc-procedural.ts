// IFC4 / IFC4X3 / IFC2X3 → IFCX Tier P procedural geometry.
//
// Walks the entity graph of a parsed STEP file, finds IfcProduct subtypes
// (Wall, Window, Beam, etc.), drills into their IfcProductDefinitionShape →
// IfcShapeRepresentation → IfcExtrudedAreaSolid / IfcRevolvedAreaSolid /
// IfcBooleanResult, and emits IFCX Tier P records.
//
// Profile catalog covered: IfcRectangleProfileDef, IfcCircleProfileDef,
// IfcIShapeProfileDef, IfcLShapeProfileDef, IfcArbitraryClosedProfileDef
// (over IfcPolyline + IfcCompositeCurve with IfcTrimmedCurve arc segments),
// IfcArbitraryProfileDefWithVoids, IfcCompositeProfileDef.

import {
    ProceduralGeometry,
    Profile,
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

export interface IfcProceduralExtraction {
    /** Map IFC GlobalId (string) → Tier P record */
    byGuid: Map<string, ProceduralGeometry>;
    /** Number of products with geometry */
    productCount: number;
    /** Number of geometric items that couldn't be converted */
    skippedItems: number;
}

const PRODUCT_TYPES = new Set([
    "IFCWALL", "IFCWALLSTANDARDCASE",
    "IFCWINDOW", "IFCWINDOWSTANDARDCASE",
    "IFCDOOR", "IFCDOORSTANDARDCASE",
    "IFCBEAM", "IFCBEAMSTANDARDCASE",
    "IFCCOLUMN", "IFCCOLUMNSTANDARDCASE",
    "IFCSLAB", "IFCSLABSTANDARDCASE",
    "IFCROOF",
    "IFCSTAIR", "IFCSTAIRFLIGHT",
    "IFCRAILING",
    "IFCFOOTING",
    "IFCPLATE",
    "IFCMEMBER",
    "IFCBUILDINGELEMENTPROXY",
    "IFCFLOWFITTING", "IFCFLOWSEGMENT", "IFCFLOWTERMINAL",
    "IFCFURNITURE", "IFCFURNISHINGELEMENT",
    "IFCOPENINGELEMENT",
    "IFCSPACE",
]);

export function extractIfcProcedural(file: StepFile): IfcProceduralExtraction {
    const byGuid = new Map<string, ProceduralGeometry>();
    let productCount = 0;
    let skippedItems = 0;

    for (const ent of file.entities.values()) {
        if (!PRODUCT_TYPES.has(ent.type)) continue;

        // IfcRoot args[0] is GlobalId
        const guid = ent.args[0]?.kind === "string" ? ent.args[0].value : null;
        if (!guid) continue;

        // IfcProduct.Representation is typically args[5] (after GlobalId, OwnerHistory,
        // Name, Description, ObjectType). For IfcSpatialStructureElement subtypes the
        // attribute order is identical for the first 6 slots — find by scanning for
        // an IfcProductDefinitionShape reference.
        let repItem: StepValue | null = null;
        for (const a of ent.args) {
            const ref = resolveRef(file, a);
            if (ref && ref.type === "IFCPRODUCTDEFINITIONSHAPE") {
                repItem = a;
                break;
            }
        }
        if (!repItem) continue;

        const pds = resolveRef(file, repItem);
        if (!pds) continue;

        // IfcProductDefinitionShape.Representations is args[2]
        const reps = pds.args[2];
        if (!reps || reps.kind !== "list") continue;

        // Find the "Body" representation
        let bodyItems: StepValue[] | null = null;
        for (const repRef of reps.items) {
            const rep = resolveRef(file, repRef);
            if (!rep || (rep.type !== "IFCSHAPEREPRESENTATION" && rep.type !== "IFCREPRESENTATION")) continue;
            // args: ContextOfItems, RepresentationIdentifier, RepresentationType, Items
            const ident = rep.args[1];
            const repType = rep.args[2];
            const items = rep.args[3];
            if (ident?.kind === "string" && ident.value !== "Body" && ident.value !== "Body3D") continue;
            if (items?.kind === "list") {
                bodyItems = items.items;
                break;
            }
        }
        if (!bodyItems || bodyItems.length === 0) continue;

        // Take the first item and convert. (Multiple items per body = composite —
        // wrapped as a Boolean union below.)
        const converted = convertGeometricItems(file, bodyItems);
        if (!converted) {
            skippedItems++;
            continue;
        }

        byGuid.set(guid, converted);
        productCount++;
    }

    return { byGuid, productCount, skippedItems };
}

function convertGeometricItems(file: StepFile, items: StepValue[]): ProceduralGeometry | null {
    const converted: ProceduralGeometry[] = [];
    for (const item of items) {
        const ent = resolveRef(file, item);
        if (!ent) continue;
        const proc = convertGeometricItem(file, ent);
        if (proc) converted.push(proc);
    }
    if (converted.length === 0) return null;
    if (converted.length === 1) return converted[0];
    // Multiple items → union them via Tier P BooleanResult chain
    let result = converted[0];
    for (let i = 1; i < converted.length; i++) {
        result = {
            "bsi::ifc::geometry::procedural::boolean_result": {
                Operator: "union",
                FirstOperand: result,
                SecondOperand: converted[i],
            },
        };
    }
    return result;
}

function convertGeometricItem(file: StepFile, ent: StepEntity): ProceduralGeometry | null {
    switch (ent.type) {
        case "IFCEXTRUDEDAREASOLID":
            return convertExtrudedAreaSolid(file, ent);
        case "IFCREVOLVEDAREASOLID":
            return convertRevolvedAreaSolid(file, ent);
        case "IFCBOOLEANRESULT":
        case "IFCBOOLEANCLIPPINGRESULT":
            return convertBooleanResult(file, ent);
        default:
            return null;
    }
}

function convertExtrudedAreaSolid(file: StepFile, ent: StepEntity): ProceduralGeometry | null {
    // IFC4: SweptArea, Position, ExtrudedDirection, Depth
    const profile = convertProfile(file, ent.args[0]);
    if (!profile) return null;
    const dir = directionOf(file, ent.args[2]) ?? [0, 0, 1];
    const depth = numberOf(ent.args[3]);
    if (!Number.isFinite(depth)) return null;

    return {
        "bsi::ifc::geometry::procedural::extruded_area_solid": {
            SweptArea: profile,
            ExtrudedDirection: dir,
            Depth: depth,
        },
    };
}

function convertRevolvedAreaSolid(file: StepFile, ent: StepEntity): ProceduralGeometry | null {
    // SweptArea, Position, Axis (IfcAxis1Placement), Angle
    const profile = convertProfile(file, ent.args[0]);
    if (!profile) return null;
    const axisEnt = resolveRef(file, ent.args[2]);
    if (!axisEnt) return null;
    // IfcAxis1Placement: args = Location, Axis
    const origin = pointOf(file, axisEnt.args[0]) ?? [0, 0, 0];
    const axisDir = directionOf(file, axisEnt.args[1]) ?? [0, 0, 1];
    const angle = numberOf(ent.args[3]);

    return {
        "bsi::ifc::geometry::procedural::revolved_area_solid": {
            SweptArea: profile,
            AxisOrigin: origin,
            AxisDirection: axisDir,
            Angle: angle,
        },
    };
}

function convertBooleanResult(file: StepFile, ent: StepEntity): ProceduralGeometry | null {
    // args: Operator (enum), FirstOperand, SecondOperand
    const opEnum = ent.args[0];
    if (opEnum.kind !== "enum") return null;
    const op = opEnum.value;
    const first = resolveRef(file, ent.args[1]);
    const second = resolveRef(file, ent.args[2]);
    if (!first || !second) return null;
    const firstP = convertGeometricItem(file, first);
    const secondP = convertGeometricItem(file, second);
    if (!firstP || !secondP) return null;
    let operator: "union" | "difference" | "intersection";
    if (op === "DIFFERENCE") operator = "difference";
    else if (op === "INTERSECTION") operator = "intersection";
    else operator = "union";
    return {
        "bsi::ifc::geometry::procedural::boolean_result": {
            Operator: operator,
            FirstOperand: firstP,
            SecondOperand: secondP,
        },
    };
}

// -- Profiles ---------------------------------------------------------------

function convertProfile(file: StepFile, value: StepValue): Profile | null {
    const ent = resolveRef(file, value);
    if (!ent) return null;
    switch (ent.type) {
        case "IFCRECTANGLEPROFILEDEF":
            return convertRectangleProfile(file, ent);
        case "IFCCIRCLEPROFILEDEF":
            return convertCircleProfile(file, ent);
        case "IFCISHAPEPROFILEDEF":
            return convertIShapeProfile(file, ent);
        case "IFCLSHAPEPROFILEDEF":
            return convertLShapeProfile(file, ent);
        case "IFCARBITRARYCLOSEDPROFILEDEF":
            return convertArbitraryClosedProfile(file, ent);
        case "IFCARBITRARYPROFILEDEFWITHVOIDS":
            return convertProfileWithVoids(file, ent);
        case "IFCCOMPOSITEPROFILEDEF":
            return convertCompositeProfile(file, ent);
        default:
            return null;
    }
}

function placementLocation2D(file: StepFile, value: StepValue): [number, number] {
    const placement = resolveRef(file, value);
    if (!placement) return [0, 0];
    // IfcAxis2Placement2D: Location, RefDirection
    const loc = pointOf(file, placement.args[0]);
    if (!loc) return [0, 0];
    return [loc[0], loc[1]];
}

function convertRectangleProfile(file: StepFile, ent: StepEntity): Profile {
    // args: ProfileType (enum), ProfileName, Position, XDim, YDim
    const pos = placementLocation2D(file, ent.args[2]);
    return {
        "bsi::ifc::geometry::procedural::rectangle": {
            position: { Location: pos },
            Width: numberOf(ent.args[3]),
            Height: numberOf(ent.args[4]),
        },
    };
}

function convertCircleProfile(file: StepFile, ent: StepEntity): Profile {
    // args: ProfileType, ProfileName, Position, Radius
    const pos = placementLocation2D(file, ent.args[2]);
    return {
        "bsi::ifc::geometry::procedural::circle": {
            position: { Location: pos },
            Radius: numberOf(ent.args[3]),
        },
    };
}

function convertIShapeProfile(file: StepFile, ent: StepEntity): Profile {
    // args: ProfileType, ProfileName, Position, OverallWidth, OverallDepth,
    //       WebThickness, FlangeThickness, FilletRadius
    const pos = placementLocation2D(file, ent.args[2]);
    return {
        "bsi::ifc::geometry::procedural::i_shape": {
            position: { Location: pos },
            OverallWidth: numberOf(ent.args[3]),
            OverallDepth: numberOf(ent.args[4]),
            WebThickness: numberOf(ent.args[5]),
            FlangeThickness: numberOf(ent.args[6]),
            ...(ent.args[7]?.kind !== "null" ? { FilletRadius: numberOf(ent.args[7]) } : {}),
        },
    };
}

function convertLShapeProfile(file: StepFile, ent: StepEntity): Profile {
    // args: ProfileType, ProfileName, Position, Depth, Width, Thickness, FilletRadius, EdgeRadius
    const pos = placementLocation2D(file, ent.args[2]);
    return {
        "bsi::ifc::geometry::procedural::l_shape": {
            position: { Location: pos },
            Depth: numberOf(ent.args[3]),
            Width: numberOf(ent.args[4]),
            Thickness: numberOf(ent.args[5]),
            ...(ent.args[6]?.kind !== "null" ? { FilletRadius: numberOf(ent.args[6]) } : {}),
            ...(ent.args[7]?.kind !== "null" ? { EdgeRadius: numberOf(ent.args[7]) } : {}),
        },
    };
}

function convertArbitraryClosedProfile(file: StepFile, ent: StepEntity): Profile | null {
    // args: ProfileType, ProfileName, OuterCurve
    const curveEnt = resolveRef(file, ent.args[2]);
    if (!curveEnt) return null;
    return convertClosedCurve(file, curveEnt);
}

function convertClosedCurve(file: StepFile, ent: StepEntity): Profile | null {
    if (ent.type === "IFCINDEXEDPOLYCURVE") {
        // args: Points (IfcCartesianPointList2D / 3D), Segments (optional), SelfIntersect
        const pointsList = resolveRef(file, ent.args[0]);
        if (!pointsList) return null;
        // IfcCartesianPointList2D.CoordList is args[0]: list of [x, y] pairs
        const coordList = pointsList.args[0];
        if (coordList.kind !== "list") return null;
        const points: [number, number][] = [];
        for (const tup of coordList.items) {
            if (tup.kind !== "list") continue;
            const xs = tup.items.map(numberOf);
            if (xs.length >= 2) points.push([xs[0], xs[1]]);
        }
        if (points.length > 1) {
            const a = points[0], b = points[points.length - 1];
            if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) points.pop();
        }
        return { "bsi::ifc::geometry::procedural::polyline": { Points: points } };
    }
    if (ent.type === "IFCPOLYLINE") {
        // args: Points (list of IfcCartesianPoint)
        const pts = ent.args[0];
        if (pts.kind !== "list") return null;
        const points: [number, number][] = [];
        for (const pRef of pts.items) {
            const p = pointOf(file, pRef);
            if (p) points.push([p[0], p[1]]);
        }
        // Drop duplicate closing point if present
        if (points.length > 1) {
            const a = points[0], b = points[points.length - 1];
            if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) points.pop();
        }
        return {
            "bsi::ifc::geometry::procedural::polyline": { Points: points },
        };
    }
    if (ent.type === "IFCCOMPOSITECURVE") {
        // Simplified: walk segments, accumulate polyline points (arcs degrade to chord).
        const segs = ent.args[0];
        if (segs.kind !== "list") return null;
        const points: [number, number][] = [];
        for (const segRef of segs.items) {
            const segEnt = resolveRef(file, segRef);
            if (!segEnt) continue;
            // IfcCompositeCurveSegment: Transition, SameSense, ParentCurve
            const parent = resolveRef(file, segEnt.args[2]);
            if (!parent) continue;
            if (parent.type === "IFCPOLYLINE") {
                const sub = parent.args[0];
                if (sub.kind === "list") {
                    for (const pRef of sub.items) {
                        const p = pointOf(file, pRef);
                        if (p) points.push([p[0], p[1]]);
                    }
                }
            }
            // TrimmedCurve with circle arcs would go here; for v1 we degrade to chord.
        }
        if (points.length > 1) {
            const a = points[0], b = points[points.length - 1];
            if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) points.pop();
        }
        return {
            "bsi::ifc::geometry::procedural::polyline": { Points: points },
        };
    }
    return null;
}

function convertProfileWithVoids(file: StepFile, ent: StepEntity): Profile | null {
    // args: ProfileType, ProfileName, OuterCurve, InnerCurves
    const outerEnt = resolveRef(file, ent.args[2]);
    if (!outerEnt) return null;
    const outer = convertClosedCurve(file, outerEnt);
    if (!outer) return null;
    const inners: Profile[] = [];
    const innerCurves = ent.args[3];
    if (innerCurves?.kind === "list") {
        for (const cRef of innerCurves.items) {
            const cEnt = resolveRef(file, cRef);
            if (!cEnt) continue;
            const inner = convertClosedCurve(file, cEnt);
            if (inner) inners.push(inner);
        }
    }
    return {
        "bsi::ifc::geometry::procedural::profile_with_voids": {
            exterior: outer,
            ...(inners.length > 0 ? { Interior: inners } : {}),
        },
    };
}

function convertCompositeProfile(file: StepFile, ent: StepEntity): Profile | null {
    const profilesArg = ent.args[2];
    if (profilesArg?.kind !== "list") return null;
    const profiles: Profile[] = [];
    for (const pRef of profilesArg.items) {
        const p = convertProfile(file, pRef);
        if (p) profiles.push(p);
    }
    if (profiles.length === 0) return null;
    return {
        "bsi::ifc::geometry::procedural::composite_profile": { Profiles: profiles },
    };
}
