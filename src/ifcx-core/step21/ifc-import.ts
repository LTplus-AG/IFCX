// Full IFC4 / IFC4X3 / IFC2X3 STEP file → tiered IFCX, in pure TypeScript.
// Browser-safe (no Node-only dependencies, no WASM). Designed to be called
// from the viewer's file-upload path so a user can drop an .ifc file in
// and have the importer round-trip it without going through the CLI.
//
// Output shape matches what `convertAlphaToTiered` produces — the same
// `IndexFileData` + ndjson string map the viewer's existing tiered loader
// already consumes.

import { ProceduralGeometry } from "../geometry/geometry-tiers";
import { IndexFileData, IndexFileNode } from "../geometry/index-file-loader";
import { parseStep21, resolveRef, stringOf, StepEntity, StepFile } from "./parser";
import { extractIfcProcedural } from "./ifc-procedural";

export interface IfcImportResult {
    indexFile: IndexFileData;
    ndjsonFiles: Map<string, string>;
    schema: string;
    productCount: number;
    elapsedMs: number;
}

/**
 * Parse an IFC STEP file from a UTF-8 string and produce a complete tiered
 * IFCX dataset in memory: index file + semantics ndjson + procedural ndjson.
 * The viewer can hand the result directly to `loadIndexFile`.
 */
export function importIfcToTieredText(ifcText: string, sourceName = "ifc-import"): IfcImportResult {
    const t0 = Date.now();
    const file = parseStep21(ifcText);
    const proc = extractIfcProcedural(file);
    const spatial = buildSpatialTree(file);

    // Build nodes
    const ROOT_PATH = "00000000-0000-4000-8000-000000000000";
    const nodes: IndexFileNode[] = [];
    const semantics: any[] = [];
    const procEntries: ProceduralGeometry[] = [];

    // Root carries the project as its only child
    const projectGuid = spatial.projectGuid;
    if (projectGuid) {
        nodes.push({
            path: ROOT_PATH,
            children: [{ opinion: "VALUE", name: "Project", value: projectGuid }],
        });
    } else {
        nodes.push({ path: ROOT_PATH });
    }

    // Emit a node per IFC product
    for (const [guid, info] of spatial.byGuid) {
        const node: IndexFileNode = { path: guid };
        if (info.children.length > 0) {
            node.children = info.children.map(c => ({
                opinion: "VALUE",
                name: c.name,
                value: c.guid,
            }));
        }
        node.attributes = [];

        // bsi::ifc::class + Name via semantics ndjson
        const semObj: Record<string, any> = {
            "bsi::ifc::class": {
                code: info.ifcClass,
                uri: `https://identifier.buildingsmart.org/uri/buildingsmart/ifc/5/class/${info.ifcClass}`,
            },
        };
        if (info.name) semObj["bsi::ifc::prop::Name"] = info.name;
        const semIdx = semantics.length;
        semantics.push(semObj);
        node.attributes.push({
            opinion: "VALUE",
            name: "ifcx::semantics",
            value: { typeID: "ifcx.semantics", componentIndex: semIdx },
        });

        // Tier P procedural geometry if extracted
        const procRecord = proc.byGuid.get(guid);
        if (procRecord) {
            const procIdx = procEntries.length;
            procEntries.push(procRecord);
            node.attributes.push({
                opinion: "VALUE",
                name: "ifcx::geom::proc",
                value: { typeID: "ifcx.geom.proc", componentIndex: procIdx },
            });
        }

        nodes.push(node);
    }

    // Assemble index + ndjson
    const ndjsonFiles = new Map<string, string>();
    const attributeTables: IndexFileData["attributeTables"] = [];

    ndjsonFiles.set("ifcx.semantics.ndjson", semantics.map(s => JSON.stringify(s)).join("\n"));
    attributeTables.push({
        filename: "ifcx.semantics.ndjson",
        type: "NDJSON",
        schema: { description: "Semantic properties" },
    });

    if (procEntries.length > 0) {
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procEntries.map(p => JSON.stringify(p)).join("\n"));
        attributeTables.push({
            filename: "ifcx.geom.proc.ndjson",
            type: "NDJSON",
            schema: { tier: "P", description: "Procedural geometry from IFC source" },
        });
    }

    const indexFile: IndexFileData = {
        header: { ifcxVersion: "ifcx_post_alpha" },
        imports: [],
        attributeTables,
        sections: [{
            header: {
                id: sourceName,
                dataVersion: "1.0.0",
                author: "browser ifc-import",
                timestamp: new Date().toISOString(),
                application: `ifcx browser importer (schema: ${file.schema || "unknown"})`,
            },
            nodes,
        }],
    };

    return {
        indexFile,
        ndjsonFiles,
        schema: file.schema || "unknown",
        productCount: spatial.byGuid.size,
        elapsedMs: Date.now() - t0,
    };
}

// -- Spatial tree extraction -------------------------------------------------

interface NodeInfo {
    ifcClass: string;
    name: string | null;
    children: { name: string; guid: string }[];
}

interface SpatialTree {
    projectGuid: string | null;
    byGuid: Map<string, NodeInfo>;
}

const ROOT_PRODUCT_TYPES = new Set([
    "IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE",
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
]);

function buildSpatialTree(file: StepFile): SpatialTree {
    const byGuid = new Map<string, NodeInfo>();
    let projectGuid: string | null = null;

    // Pass 1: register every IfcRoot subtype we care about
    for (const ent of file.entities.values()) {
        if (!ROOT_PRODUCT_TYPES.has(ent.type)) continue;
        const guid = stringOf(ent.args[0]);
        if (!guid) continue;
        const ifcClass = pascalCase(ent.type);
        const name = ent.args[2]?.kind === "string" ? ent.args[2].value : null;
        byGuid.set(guid, { ifcClass, name, children: [] });
        if (ent.type === "IFCPROJECT") projectGuid = guid;
    }

    // Pass 2: walk IfcRelAggregates and IfcRelContainedInSpatialStructure
    for (const ent of file.entities.values()) {
        if (ent.type === "IFCRELAGGREGATES") {
            // args: GlobalId, OwnerHistory, Name, Description, RelatingObject, RelatedObjects
            const parent = resolveRef(file, ent.args[4]);
            const related = ent.args[5];
            if (!parent || related?.kind !== "list") continue;
            const parentGuid = stringOf(parent.args[0]);
            const parentInfo = parentGuid ? byGuid.get(parentGuid) : null;
            if (!parentInfo) continue;
            for (const childRef of related.items) {
                const childEnt = resolveRef(file, childRef);
                if (!childEnt) continue;
                const childGuid = stringOf(childEnt.args[0]);
                if (!childGuid || !byGuid.has(childGuid)) continue;
                const childName = byGuid.get(childGuid)?.name
                    ?? pascalCase(childEnt.type).replace("Ifc", "");
                if (!parentInfo.children.some(c => c.guid === childGuid)) {
                    parentInfo.children.push({ name: childName, guid: childGuid });
                }
            }
        } else if (ent.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
            // args: GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure
            const related = ent.args[4];
            const structure = resolveRef(file, ent.args[5]);
            if (!structure || related?.kind !== "list") continue;
            const structureGuid = stringOf(structure.args[0]);
            const structureInfo = structureGuid ? byGuid.get(structureGuid) : null;
            if (!structureInfo) continue;
            for (const childRef of related.items) {
                const childEnt = resolveRef(file, childRef);
                if (!childEnt) continue;
                const childGuid = stringOf(childEnt.args[0]);
                if (!childGuid || !byGuid.has(childGuid)) continue;
                const childName = byGuid.get(childGuid)?.name
                    ?? pascalCase(childEnt.type).replace("Ifc", "");
                if (!structureInfo.children.some(c => c.guid === childGuid)) {
                    structureInfo.children.push({ name: childName, guid: childGuid });
                }
            }
        }
    }

    return { projectGuid, byGuid };
}

function pascalCase(stepType: string): string {
    // STEP entity names are UPPER_SNAKE_CASE. Convert to PascalCase IFC class
    // names ("IFCWALL" → "IfcWall", "IFCBUILDINGSTOREY" → "IfcBuildingStorey",
    // "IFCWALL_STANDARDCASE" doesn't exist; IFC keeps PascalCase even though
    // STEP serializes uppercase).
    if (stepType.startsWith("IFC")) {
        // Special-case known multi-word IFC types so we get the right casing.
        const known: Record<string, string> = {
            IFCPROJECT: "IfcProject",
            IFCSITE: "IfcSite",
            IFCBUILDING: "IfcBuilding",
            IFCBUILDINGSTOREY: "IfcBuildingStorey",
            IFCSPACE: "IfcSpace",
            IFCWALL: "IfcWall",
            IFCWALLSTANDARDCASE: "IfcWallStandardCase",
            IFCWINDOW: "IfcWindow",
            IFCWINDOWSTANDARDCASE: "IfcWindowStandardCase",
            IFCDOOR: "IfcDoor",
            IFCDOORSTANDARDCASE: "IfcDoorStandardCase",
            IFCBEAM: "IfcBeam",
            IFCBEAMSTANDARDCASE: "IfcBeamStandardCase",
            IFCCOLUMN: "IfcColumn",
            IFCCOLUMNSTANDARDCASE: "IfcColumnStandardCase",
            IFCSLAB: "IfcSlab",
            IFCSLABSTANDARDCASE: "IfcSlabStandardCase",
            IFCROOF: "IfcRoof",
            IFCSTAIR: "IfcStair",
            IFCSTAIRFLIGHT: "IfcStairFlight",
            IFCRAILING: "IfcRailing",
            IFCFOOTING: "IfcFooting",
            IFCPLATE: "IfcPlate",
            IFCMEMBER: "IfcMember",
            IFCBUILDINGELEMENTPROXY: "IfcBuildingElementProxy",
            IFCFLOWFITTING: "IfcFlowFitting",
            IFCFLOWSEGMENT: "IfcFlowSegment",
            IFCFLOWTERMINAL: "IfcFlowTerminal",
            IFCFURNITURE: "IfcFurniture",
            IFCFURNISHINGELEMENT: "IfcFurnishingElement",
            IFCOPENINGELEMENT: "IfcOpeningElement",
        };
        return known[stepType] ?? "Ifc" + stepType.slice(3).toLowerCase().replace(/^./, c => c.toUpperCase());
    }
    return stepType;
}
