// Loads an IfcxIndexFile (post-alpha format) into the alpha-compatible IfcxFile structure
// used by the existing composition pipeline. Geometry attribute references are resolved
// through the TierResolver, which loads only the requested tiers.

import { IfcxFile, IfcxNode } from "../schema/schema-helper";
import { AttributeTable } from "./attribute-table";
import { Brep, GeometryTier, ProceduralGeometry, TIER_TABLE_NAMES, parseLatentBrepPath } from "./geometry-tiers";
import { AttributeTableProvider, InMemoryTableProvider, TierResolver } from "./tier-resolver";
import { tessellate, tessellateBrep } from "./tessellate";

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

                // Derivation: if a higher tier is present and Tier M is missing, derive a
                // display mesh from the highest available tier. Source-of-truth priority
                // matches docs/geometry-tiers-design.md: Tier P > Tier B > Tier M.
                if (attributes["usd::usdgeom::mesh::points"] === undefined) {
                    let derived = null as ReturnType<typeof tessellate>;
                    if (attributes["ifcx::geom::proc"] !== undefined) {
                        derived = tessellate(attributes["ifcx::geom::proc"] as ProceduralGeometry);
                    } else if (attributes["ifcx::geom::brep"] !== undefined) {
                        derived = tessellateBrep(attributes["ifcx::geom::brep"] as Brep);
                    }
                    if (derived) {
                        attributes["usd::usdgeom::mesh::points"] = derived.points;
                        attributes["usd::usdgeom::mesh::faceVertexIndices"] = derived.faceVertexIndices;
                        if (!schemas["usd::usdgeom::mesh::points"]) {
                            schemas["usd::usdgeom::mesh::points"] = inferSchema(derived.points);
                            schemas["usd::usdgeom::mesh::faceVertexIndices"] = inferSchema(derived.faceVertexIndices);
                        }
                        if (derived.faceGroups && derived.faceGroups.length > 0) {
                            attributes["ifcx::brep::face_groups"] = derived.faceGroups;
                            if (!schemas["ifcx::brep::face_groups"]) {
                                schemas["ifcx::brep::face_groups"] = { value: { dataType: "Object" } };
                            }
                        }
                    }
                }

                alphaNode.attributes = attributes;
            }

            data.push(alphaNode);
        }
    }

    // Resolve latent Brep sub-paths: a node authored at `bodyPath/Face_<n>` (or Edge_/Vertex_)
    // gets its attributes lifted into the parent Brep node under the key
    // `ifcx::brep::<kind>::<index>` and removed from the data array. This implements the
    // federation-friendly per-face authoring described in docs/geometry-tiers-design.md
    // (Tier B latent-path face addressing).
    const resolvedLatentPaths = resolveLatentBrepPaths(data, schemas);
    data = data.filter(n => !resolvedLatentPaths.has(n.path));

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
 * Identify nodes whose path matches the latent Brep sub-path pattern
 * (bodyPath/Face_<n>, /Edge_<n>, /Vertex_<n>) and merge their attributes into
 * the parent Brep node. Returns the set of paths that were absorbed so the
 * caller can remove them from `data`.
 *
 * Per-element attributes appear on the parent under
 *   ifcx::brep::face::<n> = { ...attrs }
 *   ifcx::brep::edge::<n> = { ...attrs }
 *   ifcx::brep::vertex::<n> = { ...attrs }
 *
 * A node is considered latent only if a parent node actually exists in this
 * file (so unrelated paths that happen to match the regex pattern aren't
 * silently absorbed — they pass through as ordinary IfcxNodes).
 */
function resolveLatentBrepPaths(data: IfcxNode[], schemas: Record<string, any>): Set<string> {
    const byPath = new Map<string, IfcxNode>();
    for (const n of data) byPath.set(n.path, n);

    const resolved = new Set<string>();
    for (const n of data) {
        const latent = parseLatentBrepPath(n.path);
        if (!latent) continue;
        const parent = byPath.get(latent.bodyPath);
        if (!parent) continue; // dangling latent path — leave as a regular node
        if (!n.attributes || Object.keys(n.attributes).length === 0) {
            // Latent node with no attributes carries no information; mark resolved (drop it)
            resolved.add(n.path);
            continue;
        }

        const key = `ifcx::brep::${latent.kind}::${latent.index}`;
        if (!parent.attributes) parent.attributes = {};
        const existing = (parent.attributes[key] as Record<string, unknown>) ?? {};
        parent.attributes[key] = { ...existing, ...n.attributes };
        if (!schemas[key]) {
            schemas[key] = { value: { dataType: "Object" } };
        }
        resolved.add(n.path);
    }
    return resolved;
}
