// Loads an IfcxIndexFile (post-alpha format) into the alpha-compatible IfcxFile structure
// used by the existing composition pipeline. Geometry attribute references are resolved
// through the TierResolver, which loads only the requested tiers.

import { IfcxFile, IfcxNode } from "../schema/schema-helper";
import { AttributeTable } from "./attribute-table";
import { GeometryTier, ProceduralGeometry, TIER_TABLE_NAMES } from "./geometry-tiers";
import { AttributeTableProvider, InMemoryTableProvider, TierResolver } from "./tier-resolver";
import { tessellate, tessellateBrep } from "./tessellate";
import { assembleBrep, AssemblerNode } from "./brep-assembler";
import { kindOfName, kindOfBody } from "./brep-reference";

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
    requestedTiers: GeometryTier[] = ["mesh"],
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
    let data: IfcxNode[] = [];
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
                                } else if (typeID === TIER_TABLE_NAMES.procedural) {
                                    attributes["ifcx::geom::proc"] = resolved;
                                    if (!schemas["ifcx::geom::proc"]) schemas["ifcx::geom::proc"] = inferSchema(resolved);
                                } else if (typeID === TIER_TABLE_NAMES.brep) {
                                    attributes["ifcx::geom::brep"] = resolved;
                                    if (!schemas["ifcx::geom::brep"]) schemas["ifcx::geom::brep"] = inferSchema(resolved);
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

                // Derivation: if Tier M is missing, derive a display mesh from procedural
                // geometry (self-contained per node). Brep is NOT self-contained — its
                // topology is spread across child nodes — so Brep derivation happens in a
                // post-pass over the whole node set (assembleAndTessellateBreps below).
                if (attributes["usd::usdgeom::mesh::points"] === undefined &&
                    attributes["ifcx::geom::proc"] !== undefined) {
                    const derived = tessellate(attributes["ifcx::geom::proc"] as ProceduralGeometry);
                    if (derived) {
                        attributes["usd::usdgeom::mesh::points"] = derived.points;
                        attributes["usd::usdgeom::mesh::faceVertexIndices"] = derived.faceVertexIndices;
                        if (!schemas["usd::usdgeom::mesh::points"]) {
                            schemas["usd::usdgeom::mesh::points"] = inferSchema(derived.points);
                            schemas["usd::usdgeom::mesh::faceVertexIndices"] = inferSchema(derived.faceVertexIndices);
                        }
                    }
                }

                alphaNode.attributes = attributes;
            }

            data.push(alphaNode);
        }
    }

    // Assemble Brep bodies from their topology child nodes and derive a display
    // mesh. Topology is identity-bearing child nodes referenced by relative path
    // (no latent-path absorption); per-face opinions live on the real face nodes
    // and are merged by ordinary composition downstream.
    assembleAndTessellateBreps(data, schemas);

    // Use the first section's header.id as the alpha file ID. The previous code used
    // ifcxVersion which is a format identifier, not a unique file ID — every reload
    // collided in the InMemoryLayerProvider with "duplicate ID".
    const sectionId = indexData.sections[0]?.header.id;
    const fileId = sectionId && sectionId.length > 0 ? sectionId : `ifcx-tiered-${Date.now()}`;
    return {
        header: {
            id: fileId,
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

/**
 * Find Brep body nodes — nodes whose children carry Brep topology rows — assemble
 * each into a flat in-memory Brep (resolving relative-path references), tessellate
 * once, and attach the display mesh + face groups to the body node. The mesh is
 * derived only when absent (a cached Tier-M mesh on the body wins).
 *
 * A node is treated as a Brep body when at least one of its children carries an
 * `ifcx::geom::brep` row that classifies as a topology primitive.
 */
function assembleAndTessellateBreps(data: IfcxNode[], schemas: Record<string, any>): void {
    // A path may carry several opinions (separate layers): the topology row lives
    // on one of them, a federated material/semantics opinion on another. Index the
    // Brep row by path, taking the first node at each path that carries one.
    const brepRowByPath = new Map<string, any>();
    for (const n of data) {
        const row = n.attributes?.["ifcx::geom::brep"];
        if (row !== undefined && !brepRowByPath.has(n.path)) brepRowByPath.set(n.path, row);
    }

    const processed = new Set<string>();
    for (const node of data) {
        if (!node.children || processed.has(node.path)) continue;

        const children: AssemblerNode[] = [];
        let hasPrimitive = false;
        for (const [name, childPath] of Object.entries(node.children)) {
            if (typeof childPath !== "string") continue;
            const body = brepRowByPath.get(childPath);
            if (body === undefined) continue;
            children.push({ name, body });
            const kind = kindOfName(name) ?? kindOfBody(body);
            if (kind !== "body") hasPrimitive = true;
        }
        if (!hasPrimitive) continue;
        processed.add(node.path);

        const bodyBody = node.attributes?.["ifcx::geom::brep"];
        const { brep, faceNames } = assembleBrep({ bodyBody, children });

        if (node.attributes?.["usd::usdgeom::mesh::points"] !== undefined) continue;
        const derived = tessellateBrep(brep, {}, faceNames);
        if (!derived) continue;

        if (!node.attributes) node.attributes = {};
        node.attributes["usd::usdgeom::mesh::points"] = derived.points;
        node.attributes["usd::usdgeom::mesh::faceVertexIndices"] = derived.faceVertexIndices;
        if (!schemas["usd::usdgeom::mesh::points"]) {
            schemas["usd::usdgeom::mesh::points"] = inferSchema(derived.points);
            schemas["usd::usdgeom::mesh::faceVertexIndices"] = inferSchema(derived.faceVertexIndices);
        }
        if (derived.faceGroups && derived.faceGroups.length > 0) {
            node.attributes["ifcx::brep::face_groups"] = derived.faceGroups;
            if (!schemas["ifcx::brep::face_groups"]) {
                schemas["ifcx::brep::face_groups"] = { value: { dataType: "Object" } };
            }
        }
    }
}
