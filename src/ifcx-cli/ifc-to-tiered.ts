// IFC4 / IFC4X3 / IFC2X3 STEP file → IFCX tiered format.
//
// Phase 6 (v1): builds on @ifc-lite for parse + Ifc5Exporter for the schema
// conversion (spatial hierarchy + classes + names + properties). Then runs
// the resulting alpha-format IFCX through `convertAlphaToTiered` to produce
// the tiered output (index.ifcx + ndjson tables).
//
// Geometry note: native procedural / Brep extraction from IFC source is
// deferred. ifc-lite's geometry processor is WASM-based and Node lacks
// `file://` fetch out of the box. The v1 importer ships the structural
// round-trip (spatial + semantics + IFC GUIDs preserved as paths); a
// separate milestone adds Tier P / Tier B geometry conversion either via
// a Node-WASM shim or by re-parsing geometry primitives directly.

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";

import { convertAlphaToTiered } from "../ifcx-core/geometry/alpha-to-tiered";
import { ProceduralGeometry as ProceduralGeometryEntry } from "../ifcx-core/geometry/geometry-tiers";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";
import { parseStep21 } from "../ifcx-core/step21/parser";
import { extractIfcProcedural } from "../ifcx-core/step21/ifc-procedural";

// ifc-lite is an external tool, intentionally NOT a workspace dependency. We
// resolve its pre-built ESM dist at RUNTIME rather than static-importing an
// absolute path: a static absolute import cannot be bundled on a checkout that
// lacks the sibling repo, which takes the whole test suite down with it. The
// only structural surface we use is captured below so nothing here depends on
// ifc-lite's own types.
export interface IfcLiteBackend {
    IfcParser: new () => { parseColumnar(ab: ArrayBuffer): Promise<any> };
    Ifc5Exporter: new (store: any, opts: any) => { export(o: any): { content: string } };
}

/** Thrown when the ifc-lite backend cannot be located; callers may treat as skippable. */
export class IfcLiteUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "IfcLiteUnavailableError";
    }
}

/** ifc-lite `packages` dirs to probe, in priority order. */
function ifcLiteCandidateDirs(): string[] {
    const dirs: string[] = [];
    if (process.env.IFC_LITE_DIST) dirs.push(process.env.IFC_LITE_DIST);
    try {
        // Sibling checkout: <parent>/ifc-lite/packages relative to the running
        // module/bundle (src/*.mjs) — matches the local dev layout.
        dirs.push(fileURLToPath(new URL("../../ifc-lite/packages", import.meta.url)));
    } catch {
        // import.meta.url unavailable in this context — skip the sibling probe.
    }
    return dirs;
}

// The specifiers below are computed, so esbuild leaves them as runtime imports
// (it does not try to resolve ifc-lite at bundle time) and the build succeeds
// even when ifc-lite is absent.
async function resolveIfcLite(backend?: IfcLiteBackend): Promise<IfcLiteBackend> {
    if (backend) return backend;
    for (const base of ifcLiteCandidateDirs()) {
        const parserPath = path.join(base, "parser", "dist", "index.js");
        const exportPath = path.join(base, "export", "dist", "index.js");
        if (!fs.existsSync(parserPath) || !fs.existsSync(exportPath)) continue;
        try {
            const parserMod: any = await import(pathToFileURL(parserPath).href);
            const exportMod: any = await import(pathToFileURL(exportPath).href);
            return { IfcParser: parserMod.IfcParser, Ifc5Exporter: exportMod.Ifc5Exporter };
        } catch (e) {
            // Present but not loadable (e.g. unbuilt / unlinked workspace deps).
            throw new IfcLiteUnavailableError(`ifc-lite at ${base} failed to load: ${(e as Error).message}`);
        }
    }
    throw new IfcLiteUnavailableError(
        "ifc-lite not found. Set IFC_LITE_DIST to the ifc-lite `packages` directory to enable IFC import.",
    );
}

export interface IfcToTieredOptions {
    /** Pretty-print the index.ifcx output (default: true) */
    prettyPrint?: boolean;
    /** Author string for the IFCX header */
    author?: string;
}

export interface IfcToTieredResult {
    indexPath: string;
    ndjsonPaths: string[];
    sourceSchema: string;
    nodeCount: number;
    elapsedMs: number;
}

/**
 * Convert an IFC STEP file into a tiered IFCX directory.
 *
 * Output structure:
 *   <outDir>/index.ifcx             — index file (post-alpha schema)
 *   <outDir>/ifcx.semantics.ndjson  — per-element semantic attributes
 *
 * IFC GUIDs from the source file are preserved as IFCX paths (per voter
 * registration in IFCX-CORE #3, decision direction: preserve IFC GUIDs).
 */
export async function ifcToTiered(
    inputIfcPath: string,
    outDir: string,
    opts: IfcToTieredOptions = {},
    backend?: IfcLiteBackend,
): Promise<IfcToTieredResult> {
    const t0 = Date.now();

    if (!fs.existsSync(inputIfcPath)) {
        throw new Error(`IFC file not found: ${inputIfcPath}`);
    }

    // Resolve the ifc-lite backend lazily (throws IfcLiteUnavailableError if absent).
    const { IfcParser, Ifc5Exporter } = await resolveIfcLite(backend);

    // 1. Parse IFC via ifc-lite (suppress its console output for cleaner CLI)
    const buf = fs.readFileSync(inputIfcPath);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const parser = new IfcParser();
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = () => { };
    console.warn = () => { };
    let store: any;
    try {
        store = await parser.parseColumnar(arrayBuffer);
    } finally {
        console.log = origLog;
        console.warn = origWarn;
    }

    // 2. Run Ifc5Exporter to get alpha-format IFCX JSON.
    //    Geometry is deferred (v1 limitation, see file header).
    const exporter = new Ifc5Exporter(store, null);
    const exportResult = exporter.export({
        author: opts.author ?? "ifcx-cli ifc2tiered",
        includeGeometry: false,
        includeProperties: true,
        prettyPrint: false,
        onlyTreeEntities: true,
    });

    const alphaFile = JSON.parse(exportResult.content) as IfcxFile;

    // 3. Extract Tier P procedural geometry directly from the STEP source.
    //    The columnar parser doesn't surface IfcExtrudedAreaSolid etc. (they're
    //    "Unknown" in its enum), so we re-parse the STEP text with our own
    //    minimal STEP21 parser and walk the entity graph.
    const stepText = buf.toString("utf-8");
    const stepFile = parseStep21(stepText);
    const procExtraction = extractIfcProcedural(stepFile);

    // 4. Convert alpha → tiered (semantics + spatial structure).
    const conversion = convertAlphaToTiered(alphaFile);

    // 5. Inject Tier P entries on nodes whose path matches an extracted GUID.
    //    The Tier P table uses `ifcx.geom.proc` filename and `ifcx::geom::proc`
    //    attribute name, matching the convention.
    const procEntries: ProceduralGeometryEntry[] = [];
    let injected = 0;
    if (procExtraction.byGuid.size > 0) {
        const nodes = conversion.indexFile.sections[0].nodes;
        for (const node of nodes) {
            const proc = procExtraction.byGuid.get(node.path);
            if (!proc) continue;
            const compIdx = procEntries.length;
            procEntries.push(proc);
            (node.attributes ??= []).push({
                opinion: "VALUE",
                name: "ifcx::geom::proc",
                value: { typeID: "ifcx.geom.proc", componentIndex: compIdx },
            });
            injected++;
        }
        if (procEntries.length > 0) {
            conversion.indexFile.attributeTables.push({
                filename: "ifcx.geom.proc.ndjson",
                type: "NDJSON",
                schema: { tier: "P", description: "Procedural geometry from IFC source" },
            });
            conversion.ndjsonFiles.set(
                "ifcx.geom.proc.ndjson",
                procEntries.map(p => JSON.stringify(p)).join("\n"),
            );
        }
    }

    // 6. Write output directory.
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const indexFile = conversion.indexFile;
    indexFile.sections[0].header.application = "ifcx-cli ifc2tiered (via @ifc-lite + STEP21 reader)";
    indexFile.sections[0].header.id = path.basename(inputIfcPath, path.extname(inputIfcPath));

    const indexJson = opts.prettyPrint === false
        ? JSON.stringify(indexFile)
        : JSON.stringify(indexFile, null, 2);
    const indexPath = path.join(outDir, "index.ifcx");
    fs.writeFileSync(indexPath, indexJson);

    const ndjsonPaths: string[] = [];
    for (const [filename, content] of conversion.ndjsonFiles) {
        const filePath = path.join(outDir, filename);
        fs.writeFileSync(filePath, content);
        ndjsonPaths.push(filePath);
    }

    return {
        indexPath,
        ndjsonPaths,
        sourceSchema: store.schemaVersion ?? "unknown",
        nodeCount: indexFile.sections[0].nodes.length,
        elapsedMs: Date.now() - t0,
    };
}
