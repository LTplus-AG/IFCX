// STEP AP242 file → IFCX tiered directory.
//
// Phase 7.1: parses an AP242 STEP file via our minimal STEP21 reader,
// extracts every manifold_solid_brep into IFCX Tier B, and writes a
// tiered IFCX directory. Each Brep gets its own IfcxNode under a single
// root.

import * as fs from "fs";
import * as path from "path";

import { parseStep21 } from "../ifcx-core/step21/parser";
import { extractAp242Breps } from "../ifcx-core/step21/ap242-brep";
import { Brep } from "../ifcx-core/geometry/geometry-tiers";

export interface Ap242ToTieredResult {
    indexPath: string;
    ndjsonPaths: string[];
    schema: string;
    brepCount: number;
    elapsedMs: number;
}

export function ap242ToTiered(inputPath: string, outDir: string): Ap242ToTieredResult {
    const t0 = Date.now();
    if (!fs.existsSync(inputPath)) {
        throw new Error(`STEP file not found: ${inputPath}`);
    }
    const text = fs.readFileSync(inputPath, "utf-8");
    const stepFile = parseStep21(text);
    const breps = extractAp242Breps(stepFile);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const baseName = path.basename(inputPath, path.extname(inputPath));
    const rootPath = "00000000-0000-4000-8000-000000000000";

    const nodes: any[] = [
        { path: rootPath, children: [] as any[] },
    ];

    const brepNdjson: string[] = [];
    breps.forEach((brep: Brep, i: number) => {
        const childName = `Brep_${i}`;
        const childPath = `${baseName}-brep-${i}`;
        nodes[0].children.push({ opinion: "VALUE", name: childName, value: childPath });
        nodes.push({
            path: childPath,
            attributes: [{
                opinion: "VALUE",
                name: "ifcx::geom::brep",
                value: { typeID: "ifcx.geom.brep", componentIndex: i },
            }],
        });
        brepNdjson.push(JSON.stringify(brep));
    });

    const indexFile = {
        header: { ifcxVersion: "ifcx_post_alpha" },
        imports: [],
        attributeTables: brepNdjson.length > 0
            ? [{ filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: { tier: "B", description: "Native Brep from STEP AP242" } }]
            : [],
        sections: [{
            header: {
                id: baseName,
                dataVersion: "1.0.0",
                author: "ifcx-cli ap242_to_tiered",
                timestamp: new Date().toISOString(),
                application: `ifcx-cli ap242_to_tiered (STEP schema: ${stepFile.schema || "unknown"})`,
            },
            nodes,
        }],
    };

    const indexPath = path.join(outDir, "index.ifcx");
    fs.writeFileSync(indexPath, JSON.stringify(indexFile, null, 2));
    const ndjsonPaths: string[] = [];
    if (brepNdjson.length > 0) {
        const brepPath = path.join(outDir, "ifcx.geom.brep.ndjson");
        fs.writeFileSync(brepPath, brepNdjson.join("\n"));
        ndjsonPaths.push(brepPath);
    }

    return {
        indexPath,
        ndjsonPaths,
        schema: stepFile.schema,
        brepCount: breps.length,
        elapsedMs: Date.now() - t0,
    };
}
