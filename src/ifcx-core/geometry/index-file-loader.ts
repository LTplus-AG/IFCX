// Loads an IfcxIndexFile (post-alpha format) into the alpha-compatible IfcxFile structure
// used by the existing composition pipeline. Geometry attribute references are resolved
// through the TierResolver, which loads only the requested tiers.

import { IfcxFile, IfcxNode } from "../schema/schema-helper";
import { AttributeTable } from "./attribute-table";
import { GeometryTier, TIER_TABLE_NAMES } from "./geometry-tiers";
import { AttributeTableProvider, InMemoryTableProvider, TierResolver } from "./tier-resolver";

export interface IndexFileData {
    header: {
        ifcxVersion: string;
    };
    imports: { uri: string; integrity?: string }[];
    attributeTables: {
        filename: string;
        type: string;
        schema: unknown;
    }[];
    sections: {
        header: {
            id: string;
            dataVersion: string;
            author: string;
            timestamp: string;
            application: string;
        };
        nodes: IndexFileNode[];
    }[];
}

export interface IndexFileNode {
    path: string;
    children?: { opinion: string; name: string; value?: string }[];
    inherits?: { opinion: string; name: string; value?: string }[];
    attributes?: { opinion: string; name: string; value?: { typeID: string; componentIndex: number } }[];
}

export interface TieredLoadResult {
    alphaFile: IfcxFile;
    tierResolver: TierResolver;
    tableProvider: AttributeTableProvider;
}

export function loadIndexFile(
    indexData: IndexFileData,
    ndjsonFiles: Map<string, string>,
    requestedTiers: GeometryTier[] = ["mesh"]
): TieredLoadResult {
    // Build table provider from NDJSON files
    const tableProvider = new InMemoryTableProvider();
    for (const [filename, content] of ndjsonFiles) {
        // Strip .ndjson extension for table name matching
        const tableName = filename.replace(/\.ndjson$/, "");
        tableProvider.addTable(new AttributeTable(tableName, content));
    }

    // Create tier resolver with only the requested tiers
    const tierResolver = new TierResolver(tableProvider, requestedTiers);

    // Convert index file nodes to alpha-format IfcxFile
    const alphaFile = convertToAlpha(indexData, tierResolver, tableProvider);

    return { alphaFile, tierResolver, tableProvider };
}

// Standard schema imports needed by the alpha composition pipeline
const STANDARD_IMPORTS = [
    { uri: "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx" },
    { uri: "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx" },
    { uri: "https://ifcx.dev/@openusd.org/usd@v1.ifcx" },
];

// Infer a permissive schema from a runtime value (used for properties not covered by standard imports)
function inferSchema(value: unknown): { value: { dataType: string; optional?: boolean } } {
    if (Array.isArray(value)) {
        return { value: { dataType: "Array", arrayRestrictions: { value: inferSchema(value[0] ?? "").value } } as any };
    } else if (typeof value === "object" && value !== null) {
        return { value: { dataType: "Object" } };
    } else if (typeof value === "number") {
        return { value: { dataType: "Real" } };
    } else if (typeof value === "boolean") {
        return { value: { dataType: "Boolean" } };
    }
    return { value: { dataType: "String" } };
}

function convertToAlpha(
    indexData: IndexFileData,
    tierResolver: TierResolver,
    tableProvider: AttributeTableProvider
): IfcxFile {
    const data: IfcxNode[] = [];
    const schemas: Record<string, any> = {};

    // Geometry tier table names for detection
    const tierTableNames = new Set(Object.values(TIER_TABLE_NAMES));

    for (const section of indexData.sections) {
        for (const node of section.nodes) {
            const alphaNode: IfcxNode = {
                path: node.path,
            };

            // Convert opinionated children
            if (node.children && node.children.length > 0) {
                const children: Record<string, string | null> = {};
                for (const child of node.children) {
                    if (child.opinion === "DELETE") {
                        children[child.name] = null;
                    } else if (child.opinion === "VALUE" && child.value) {
                        children[child.name] = child.value;
                    }
                }
                alphaNode.children = children;
            }

            // Convert opinionated inherits
            if (node.inherits && node.inherits.length > 0) {
                const inherits: Record<string, string | null> = {};
                for (const ih of node.inherits) {
                    if (ih.opinion === "DELETE") {
                        inherits[ih.name] = null;
                    } else if (ih.opinion === "VALUE" && ih.value) {
                        inherits[ih.name] = ih.value;
                    }
                }
                alphaNode.inherits = inherits;
            }

            // Resolve attributes through tier resolver
            if (node.attributes && node.attributes.length > 0) {
                const attributes: Record<string, any> = {};
                for (const attr of node.attributes) {
                    if (attr.opinion === "DELETE") {
                        attributes[attr.name] = null;
                    } else if (attr.opinion === "VALUE" && attr.value) {
                        const { typeID, componentIndex } = attr.value;

                        if (tierTableNames.has(typeID)) {
                            // This is a geometry tier reference — resolve through tier resolver
                            const resolved = tierResolver.resolveByRef(typeID, componentIndex);
                            if (resolved !== null) {
                                // Inject as flattened USD-style attributes for viewer compatibility
                                if (typeID === TIER_TABLE_NAMES.mesh) {
                                    const mesh = resolved as any;
                                    attributes["usd::usdgeom::mesh::points"] = mesh.points;
                                    attributes["usd::usdgeom::mesh::faceVertexIndices"] = mesh.faceVertexIndices;
                                    if (!schemas["usd::usdgeom::mesh::points"]) {
                                        schemas["usd::usdgeom::mesh::points"] = inferSchema(mesh.points);
                                        schemas["usd::usdgeom::mesh::faceVertexIndices"] = inferSchema(mesh.faceVertexIndices);
                                    }
                                    if (mesh.lod) {
                                        attributes["ifcx::geom::lod"] = mesh.lod;
                                        if (!schemas["ifcx::geom::lod"]) schemas["ifcx::geom::lod"] = inferSchema(mesh.lod);
                                    }
                                } else if (typeID === TIER_TABLE_NAMES.brep) {
                                    attributes["ifcx::geom::brep"] = resolved;
                                    if (!schemas["ifcx::geom::brep"]) schemas["ifcx::geom::brep"] = inferSchema(resolved);
                                } else if (typeID === TIER_TABLE_NAMES.proc) {
                                    attributes["ifcx::geom::proc"] = resolved;
                                    if (!schemas["ifcx::geom::proc"]) schemas["ifcx::geom::proc"] = inferSchema(resolved);
                                }
                            }
                            // If tier not allowed, the attribute is simply absent — selective parsing!
                        } else {
                            // Non-geometry attribute — resolve from its table
                            // NDJSON rows contain full attribute objects, e.g.
                            // {"bsi::ifc::class": {...}, "bsi::ifc::prop::Name": "..."}
                            // Spread all key-value pairs into the node's attributes
                            const resolved = tierResolver.resolveByRef(typeID, componentIndex);
                            if (resolved !== null && typeof resolved === "object") {
                                const row = resolved as Record<string, unknown>;
                                Object.assign(attributes, row);
                                // Infer schemas for any keys not yet covered
                                for (const [key, val] of Object.entries(row)) {
                                    if (!schemas[key]) {
                                        schemas[key] = inferSchema(val);
                                    }
                                }
                            }
                        }
                    }
                }
                alphaNode.attributes = attributes;
            }

            data.push(alphaNode);
        }
    }

    return {
        header: {
            id: indexData.header.ifcxVersion,
            ifcxVersion: indexData.header.ifcxVersion,
            dataVersion: "1.0.0",
            author: indexData.sections[0]?.header.author ?? "",
            timestamp: indexData.sections[0]?.header.timestamp ?? "",
        },
        imports: [
            ...indexData.imports.map(i => ({ uri: i.uri })),
            ...STANDARD_IMPORTS,
        ],
        schemas,
        data,
    };
}
