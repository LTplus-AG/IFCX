// Converts alpha-format IfcxFile (inline geometry) to tiered post-alpha format
// (index file + separate NDJSON attribute tables per geometry tier).
//
// v1 emits Tier M (mesh) and a generic semantics table only. Tier P (procedural)
// cannot be reliably inferred from arbitrary mesh data — examples that need
// Tier P should author it directly rather than relying on conversion.

import { IfcxFile, IfcxNode } from "../schema/schema-helper";
import { DisplayMesh, TIER_TABLE_NAMES } from "./geometry-tiers";
import { IndexFileData, IndexFileNode } from "./index-file-loader";

export interface TieredConversionResult {
    indexFile: IndexFileData;
    ndjsonFiles: Map<string, string>;
}

export function convertAlphaToTiered(alphaFile: IfcxFile): TieredConversionResult {
    const meshEntries: DisplayMesh[] = [];
    const semanticEntries: unknown[] = [];
    const nodes: IndexFileNode[] = [];

    for (const node of alphaFile.data) {
        const converted = convertNode(node, meshEntries, semanticEntries);
        nodes.push(converted);
    }

    const ndjsonFiles = new Map<string, string>();

    if (meshEntries.length > 0) {
        ndjsonFiles.set(
            `${TIER_TABLE_NAMES.mesh}.ndjson`,
            meshEntries.map(e => JSON.stringify(e)).join("\n"),
        );
    }

    if (semanticEntries.length > 0) {
        ndjsonFiles.set(
            "ifcx.semantics.ndjson",
            semanticEntries.map(e => JSON.stringify(e)).join("\n"),
        );
    }

    const attributeTables: IndexFileData["attributeTables"] = [];
    if (meshEntries.length > 0) {
        attributeTables.push({
            filename: `${TIER_TABLE_NAMES.mesh}.ndjson`,
            type: "NDJSON",
            schema: { tier: "M", description: "Display mesh geometry" },
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
    semanticEntries: unknown[],
): IndexFileNode {
    const result: IndexFileNode = {
        path: node.path,
    };

    if (node.children) {
        result.children = Object.entries(node.children).map(([name, value]) => ({
            opinion: value === null ? "DELETE" : "VALUE",
            name,
            ...(value !== null ? { value } : {}),
        }));
    }

    if (node.inherits) {
        result.inherits = Object.entries(node.inherits).map(([name, value]) => ({
            opinion: value === null ? "DELETE" : "VALUE",
            name,
            ...(value !== null ? { value } : {}),
        }));
    }

    if (node.attributes) {
        const attrs: IndexFileNode["attributes"] = [];
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
            } else if (key === "usd::usdgeom::mesh::faceVertexIndices") {
                meshIndices = value;
            } else if (key === "usd::usdgeom::mesh") {
                meshPoints = value.points;
                meshIndices = value.faceVertexIndices;
            } else {
                semanticProps[key] = value;
            }
        }

        if (meshPoints && meshIndices) {
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
        }

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
