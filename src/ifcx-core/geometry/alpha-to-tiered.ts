// Converts alpha-format IfcxFile (inline geometry) to tiered post-alpha format
// (index file + separate NDJSON attribute tables per geometry tier).

import { IfcxFile, IfcxNode } from "../schema/schema-helper";
import { DisplayMesh, ProceduralHint, TIER_TABLE_NAMES } from "./geometry-tiers";
import { IndexFileData, IndexFileNode } from "./index-file-loader";

export interface TieredConversionResult {
    indexFile: IndexFileData;
    ndjsonFiles: Map<string, string>;
}

export function convertAlphaToTiered(alphaFile: IfcxFile): TieredConversionResult {
    const meshEntries: DisplayMesh[] = [];
    const procEntries: ProceduralHint[] = [];
    const semanticEntries: unknown[] = [];
    const nodes: IndexFileNode[] = [];

    for (const node of alphaFile.data) {
        const converted = convertNode(node, meshEntries, procEntries, semanticEntries);
        nodes.push(converted);
    }

    // Build NDJSON files
    const ndjsonFiles = new Map<string, string>();

    if (meshEntries.length > 0) {
        ndjsonFiles.set(
            `${TIER_TABLE_NAMES.mesh}.ndjson`,
            meshEntries.map(e => JSON.stringify(e)).join("\n")
        );
    }

    if (procEntries.length > 0) {
        ndjsonFiles.set(
            `${TIER_TABLE_NAMES.proc}.ndjson`,
            procEntries.map(e => JSON.stringify(e)).join("\n")
        );
    }

    if (semanticEntries.length > 0) {
        ndjsonFiles.set(
            "ifcx.semantics.ndjson",
            semanticEntries.map(e => JSON.stringify(e)).join("\n")
        );
    }

    // Build attribute table references
    const attributeTables: IndexFileData["attributeTables"] = [];
    if (meshEntries.length > 0) {
        attributeTables.push({
            filename: `${TIER_TABLE_NAMES.mesh}.ndjson`,
            type: "NDJSON",
            schema: { tier: "A", description: "Display mesh geometry" },
        });
    }
    if (procEntries.length > 0) {
        attributeTables.push({
            filename: `${TIER_TABLE_NAMES.proc}.ndjson`,
            type: "NDJSON",
            schema: { tier: "C", description: "Procedural geometry hints" },
        });
    }
    if (semanticEntries.length > 0) {
        attributeTables.push({
            filename: "ifcx.semantics.ndjson",
            type: "NDJSON",
            schema: { description: "Semantic properties" },
        });
    }

    const indexFile: IndexFileData = {
        header: { ifcxVersion: "ifcx_post_alpha" },
        imports: alphaFile.imports.map(i => ({ uri: i.uri })),
        attributeTables,
        sections: [{
            header: {
                id: alphaFile.header.id || "converted",
                dataVersion: alphaFile.header.dataVersion || "1.0.0",
                author: alphaFile.header.author || "",
                timestamp: alphaFile.header.timestamp || new Date().toISOString(),
                application: "ifcx-alpha-to-tiered-converter",
            },
            nodes,
        }],
    };

    return { indexFile, ndjsonFiles };
}

function convertNode(
    node: IfcxNode,
    meshEntries: DisplayMesh[],
    procEntries: ProceduralHint[],
    semanticEntries: unknown[]
): IndexFileNode {
    const result: IndexFileNode = {
        path: node.path,
    };

    // Convert children
    if (node.children) {
        result.children = Object.entries(node.children).map(([name, value]) => ({
            opinion: value === null ? "DELETE" : "VALUE",
            name,
            ...(value !== null ? { value } : {}),
        }));
    }

    // Convert inherits
    if (node.inherits) {
        result.inherits = Object.entries(node.inherits).map(([name, value]) => ({
            opinion: value === null ? "DELETE" : "VALUE",
            name,
            ...(value !== null ? { value } : {}),
        }));
    }

    // Convert attributes — extract geometry into tiers
    if (node.attributes) {
        const attrs: IndexFileNode["attributes"] = [];
        let hasMeshPoints = false;
        let meshPoints: number[][] | null = null;
        let meshIndices: number[] | null = null;
        const semanticProps: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(node.attributes)) {
            if (value === null) {
                attrs.push({ opinion: "DELETE", name: key });
                continue;
            }

            if (key === "usd::usdgeom::mesh::points") {
                meshPoints = value;
                hasMeshPoints = true;
            } else if (key === "usd::usdgeom::mesh::faceVertexIndices") {
                meshIndices = value;
            } else if (key === "usd::usdgeom::mesh") {
                // Nested mesh object format
                meshPoints = value.points;
                meshIndices = value.faceVertexIndices;
                hasMeshPoints = true;
            } else {
                // Non-geometry attributes stay as semantic properties
                semanticProps[key] = value;
            }
        }

        // Emit mesh tier entry
        if (hasMeshPoints && meshPoints && meshIndices) {
            const mesh: DisplayMesh = {
                points: meshPoints,
                faceVertexIndices: meshIndices,
            };
            const meshIndex = meshEntries.length;
            meshEntries.push(mesh);

            attrs.push({
                opinion: "VALUE",
                name: "ifcx::geom::mesh",
                value: {
                    typeID: TIER_TABLE_NAMES.mesh,
                    componentIndex: meshIndex,
                },
            });

            // Generate procedural hint heuristic: if mesh looks like an extrusion
            // (has top/bottom faces with same Z), emit a hint
            const procHint = inferProceduralHint(mesh);
            if (procHint) {
                const procIndex = procEntries.length;
                procEntries.push(procHint);
                attrs.push({
                    opinion: "VALUE",
                    name: "ifcx::geom::proc",
                    value: {
                        typeID: TIER_TABLE_NAMES.proc,
                        componentIndex: procIndex,
                    },
                });
            }
        }

        // Emit semantic properties
        if (Object.keys(semanticProps).length > 0) {
            const semIndex = semanticEntries.length;
            semanticEntries.push(semanticProps);
            attrs.push({
                opinion: "VALUE",
                name: "ifcx::semantics",
                value: {
                    typeID: "ifcx.semantics",
                    componentIndex: semIndex,
                },
            });
        }

        if (attrs.length > 0) {
            result.attributes = attrs;
        }
    }

    return result;
}

function inferProceduralHint(mesh: DisplayMesh): ProceduralHint | null {
    if (!mesh.points || mesh.points.length < 4) return null;

    // Simple heuristic: check if points form two parallel planes (extrusion)
    const zValues = new Set(mesh.points.map(p => Math.round(p[2] * 1000) / 1000));
    if (zValues.size === 2) {
        const [z1, z2] = [...zValues].sort((a, b) => a - b);
        const height = z2 - z1;

        // Get the profile points (bottom face)
        const bottomPoints = mesh.points.filter(
            p => Math.abs(p[2] - z1) < 0.001
        );

        if (bottomPoints.length >= 3) {
            // Compute bounding box of profile
            const xs = bottomPoints.map(p => p[0]);
            const ys = bottomPoints.map(p => p[1]);
            const width = Math.max(...xs) - Math.min(...xs);
            const depth = Math.max(...ys) - Math.min(...ys);

            return {
                operation: "extrude",
                parameters: {
                    profileType: "polygon",
                    profilePointCount: bottomPoints.length,
                    width: Math.round(width * 1000) / 1000,
                    depth: Math.round(depth * 1000) / 1000,
                    height: Math.round(height * 1000) / 1000,
                    direction: [0, 0, 1],
                },
            };
        }
    }

    return null;
}
