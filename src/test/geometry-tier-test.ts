import * as fs from "fs";
import { describe, it } from "./util/cappucino";
import { expect } from "chai";

import { AttributeTable } from "../ifcx-core/geometry/attribute-table";
import { InMemoryTableProvider, TierResolver } from "../ifcx-core/geometry/tier-resolver";
import { DisplayMesh, BRepGeometry, ProceduralHint, TIER_TABLE_NAMES } from "../ifcx-core/geometry/geometry-tiers";
import { loadIndexFile, IndexFileData } from "../ifcx-core/geometry/index-file-loader";
import { convertAlphaToTiered } from "../ifcx-core/geometry/alpha-to-tiered";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";

// ── Attribute Table ──

describe("attribute table", () => {
    it("reads entries by index", () => {
        const ndjson = '{"a":1}\n{"a":2}\n{"a":3}';
        const table = new AttributeTable("test", ndjson);
        expect(table.length).to.equal(3);
        expect(table.read<{a: number}>(0).a).to.equal(1);
        expect(table.read<{a: number}>(2).a).to.equal(3);
    });

    it("throws on out-of-range index", () => {
        const table = new AttributeTable("test", '{"a":1}');
        expect(() => table.read(5)).to.throw();
    });

    it("round-trips from entries", () => {
        const entries = [{x: 1}, {x: 2}];
        const table = AttributeTable.fromEntries("test", entries);
        expect(table.length).to.equal(2);
        expect(table.read<{x: number}>(1).x).to.equal(2);
        expect(table.toNDJSON()).to.equal('{"x":1}\n{"x":2}');
    });
});

// ── Tier Resolver — Selective Loading ──

describe("tier resolver", () => {
    function makeMeshTable(): AttributeTable {
        const meshes: DisplayMesh[] = [
            { points: [[0,0,0],[1,0,0],[1,1,0]], faceVertexIndices: [0,1,2] },
            { points: [[0,0,0],[2,0,0],[2,2,0]], faceVertexIndices: [0,1,2], lod: "lod2" },
        ];
        return AttributeTable.fromEntries(TIER_TABLE_NAMES.mesh, meshes);
    }

    function makeBrepTable(): AttributeTable {
        const breps: BRepGeometry[] = [
            { format: "STEP_AP242", data: "ISO-10303-21;...", encoding: "text", tolerance: 1e-6 },
        ];
        return AttributeTable.fromEntries(TIER_TABLE_NAMES.brep, breps);
    }

    function makeProcTable(): AttributeTable {
        const procs: ProceduralHint[] = [
            { operation: "extrude", parameters: { width: 5, height: 3 } },
        ];
        return AttributeTable.fromEntries(TIER_TABLE_NAMES.proc, procs);
    }

    it("resolves display mesh when mesh tier is requested", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeBrepTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const mesh = resolver.resolveDisplayMesh(0);
        expect(mesh).to.not.be.null;
        expect(mesh!.points.length).to.equal(3);
        expect(mesh!.faceVertexIndices).to.deep.equal([0, 1, 2]);
    });

    it("returns null for BRep when only mesh tier is requested", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeBrepTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const brep = resolver.resolveBRep(0);
        expect(brep).to.be.null;
    });

    it("returns null for procedural hints when only mesh tier is requested", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const proc = resolver.resolveProceduralHint(0);
        expect(proc).to.be.null;
    });

    it("CRITICAL: viewer config never touches BRep table", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeBrepTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        // Access mesh
        resolver.resolveDisplayMesh(0);
        resolver.resolveDisplayMesh(1);

        // Try to access brep and proc (should be denied)
        resolver.resolveBRep(0);
        resolver.resolveProceduralHint(0);

        // Verify access log
        const log = resolver.accessLog;
        expect(log.has(TIER_TABLE_NAMES.mesh)).to.be.true;
        expect(log.has(TIER_TABLE_NAMES.brep)).to.be.false;
        expect(log.has(TIER_TABLE_NAMES.proc)).to.be.false;
    });

    it("analysis config loads only BRep, not mesh", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeBrepTable());
        const resolver = new TierResolver(provider, ["brep"]);

        const brep = resolver.resolveBRep(0);
        expect(brep).to.not.be.null;
        expect(brep!.format).to.equal("STEP_AP242");

        const mesh = resolver.resolveDisplayMesh(0);
        expect(mesh).to.be.null;

        expect(resolver.accessLog.has(TIER_TABLE_NAMES.brep)).to.be.true;
        expect(resolver.accessLog.has(TIER_TABLE_NAMES.mesh)).to.be.false;
    });

    it("can request all tiers simultaneously", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeBrepTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh", "brep", "proc"]);

        expect(resolver.resolveDisplayMesh(0)).to.not.be.null;
        expect(resolver.resolveBRep(0)).to.not.be.null;
        expect(resolver.resolveProceduralHint(0)).to.not.be.null;
    });

    it("handles LOD tags on mesh entries", () => {
        const provider = new InMemoryTableProvider().addTable(makeMeshTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const mesh0 = resolver.resolveDisplayMesh(0);
        expect(mesh0!.lod).to.be.undefined;

        const mesh1 = resolver.resolveDisplayMesh(1);
        expect(mesh1!.lod).to.equal("lod2");
    });
});

// ── Index File Loading ──

describe("index file loader", () => {
    function makeTestIndexFile(): { indexData: IndexFileData; ndjsonFiles: Map<string, string> } {
        const meshes: DisplayMesh[] = [
            { points: [[0,0,0],[5,0,0],[5,0,3],[0,0,3]], faceVertexIndices: [0,1,2,0,2,3] },
        ];
        const breps: BRepGeometry[] = [
            { format: "OCCT_BREP", data: "dGVzdA==", encoding: "base64", tolerance: 1e-7 },
        ];
        const procs: ProceduralHint[] = [
            { operation: "extrude", parameters: { width: 5, height: 3, depth: 0.3 } },
        ];

        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.mesh.ndjson", meshes.map(m => JSON.stringify(m)).join("\n"));
        ndjsonFiles.set("ifcx.geom.brep.ndjson", breps.map(b => JSON.stringify(b)).join("\n"));
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procs.map(p => JSON.stringify(p)).join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.mesh.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.geom.proc.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: {
                    id: "test",
                    dataVersion: "1.0.0",
                    author: "test@test.com",
                    timestamp: "2026-01-01",
                    application: "test",
                },
                nodes: [
                    {
                        path: "root",
                        children: [
                            { opinion: "VALUE", name: "Wall", value: "wall-body" },
                        ],
                    },
                    {
                        path: "wall-body",
                        attributes: [
                            {
                                opinion: "VALUE",
                                name: "ifcx::geom::mesh",
                                value: { typeID: TIER_TABLE_NAMES.mesh, componentIndex: 0 },
                            },
                            {
                                opinion: "VALUE",
                                name: "ifcx::geom::brep",
                                value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 },
                            },
                            {
                                opinion: "VALUE",
                                name: "ifcx::geom::proc",
                                value: { typeID: TIER_TABLE_NAMES.proc, componentIndex: 0 },
                            },
                        ],
                    },
                ],
            }],
        };

        return { indexData, ndjsonFiles };
    }

    it("loads with only mesh tier — viewer scenario", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh"]);

        // Should produce alpha-compatible file
        expect(result.alphaFile.data.length).to.equal(2);

        // Wall body node should have mesh attributes
        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody).to.exist;
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(wallBody!.attributes!["usd::usdgeom::mesh::faceVertexIndices"]).to.exist;

        // Should NOT have BRep or proc data
        expect(wallBody!.attributes!["ifcx::geom::brep"]).to.not.exist;
        expect(wallBody!.attributes!["ifcx::geom::proc"]).to.not.exist;
    });

    it("loads with only BRep tier — analysis scenario", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);

        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody).to.exist;

        // Should have BRep but NOT mesh
        expect(wallBody!.attributes!["ifcx::geom::brep"]).to.exist;
        expect((wallBody!.attributes!["ifcx::geom::brep"] as BRepGeometry).format).to.equal("OCCT_BREP");
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.not.exist;
    });

    it("loads with all tiers", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh", "brep", "proc"]);

        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(wallBody!.attributes!["ifcx::geom::brep"]).to.exist;
        expect(wallBody!.attributes!["ifcx::geom::proc"]).to.exist;
    });

    it("preserves spatial hierarchy (children)", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh"]);

        const root = result.alphaFile.data.find(n => n.path === "root");
        expect(root).to.exist;
        expect(root!.children!["Wall"]).to.equal("wall-body");
    });

    it("tier resolver access log confirms selective loading", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh"]);

        const log = result.tierResolver.accessLog;
        expect(log.has(TIER_TABLE_NAMES.mesh)).to.be.true;
        expect(log.has(TIER_TABLE_NAMES.brep)).to.be.false;
        expect(log.has(TIER_TABLE_NAMES.proc)).to.be.false;
    });
});

// ── Alpha to Tiered Converter ──

describe("alpha to tiered converter", () => {
    function makeAlphaWallFile(): IfcxFile {
        return {
            header: {
                id: "test-wall",
                ifcxVersion: "ifcx_alpha",
                dataVersion: "1.0.0",
                author: "test@test.com",
                timestamp: "2026-01-01",
            },
            imports: [],
            schemas: {},
            data: [
                {
                    path: "root",
                    children: { "Wall": "wall-uuid" },
                },
                {
                    path: "wall-uuid",
                    children: { "Body": "body-uuid" },
                    attributes: {
                        "bsi::ifc::class": {
                            code: "IfcWall",
                            uri: "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/IfcWall",
                        },
                        "bsi::ifc::prop::Name": "Wall-01",
                    },
                },
                {
                    path: "body-uuid",
                    attributes: {
                        "usd::usdgeom::mesh::points": [[0,0,0],[5,0,0],[5,0,3],[0,0,3]],
                        "usd::usdgeom::mesh::faceVertexIndices": [0,1,2,0,2,3],
                    },
                },
            ],
        } as IfcxFile;
    }

    it("extracts mesh geometry into Tier A NDJSON", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.ndjsonFiles.has(`${TIER_TABLE_NAMES.mesh}.ndjson`)).to.be.true;

        const meshNdjson = result.ndjsonFiles.get(`${TIER_TABLE_NAMES.mesh}.ndjson`)!;
        const mesh = JSON.parse(meshNdjson.split("\n")[0]) as DisplayMesh;
        expect(mesh.points.length).to.equal(4);
        expect(mesh.faceVertexIndices).to.deep.equal([0,1,2,0,2,3]);
    });

    it("preserves semantic properties in separate NDJSON", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.ndjsonFiles.has("ifcx.semantics.ndjson")).to.be.true;
    });

    it("produces valid index file structure", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.indexFile.header.ifcxVersion).to.equal("ifcx_post_alpha");
        expect(result.indexFile.sections.length).to.equal(1);
        expect(result.indexFile.sections[0].nodes.length).to.equal(3);
        expect(result.indexFile.attributeTables.length).to.be.greaterThan(0);
    });

    it("index file nodes reference correct component indices", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        const bodyNode = result.indexFile.sections[0].nodes.find(n => n.path === "body-uuid");
        expect(bodyNode).to.exist;

        const meshAttr = bodyNode!.attributes!.find(a => a.name === "ifcx::geom::mesh");
        expect(meshAttr).to.exist;
        expect(meshAttr!.value!.typeID).to.equal(TIER_TABLE_NAMES.mesh);
        expect(meshAttr!.value!.componentIndex).to.equal(0);
    });

    it("converted file round-trips through index file loader", () => {
        const alpha = makeAlphaWallFile();
        const converted = convertAlphaToTiered(alpha);

        // Load back with mesh tier
        const loaded = loadIndexFile(converted.indexFile, converted.ndjsonFiles, ["mesh"]);

        // The body node should have mesh data restored
        const bodyNode = loaded.alphaFile.data.find(n => n.path === "body-uuid");
        expect(bodyNode).to.exist;
        expect(bodyNode!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(bodyNode!.attributes!["usd::usdgeom::mesh::points"]).to.deep.equal(
            [[0,0,0],[5,0,0],[5,0,3],[0,0,3]]
        );
    });
});

// ── Example File Validation ──

describe("tiered example file", () => {
    let examplesFolderPath = "../examples";

    it("Hello Wall Tiered index file is valid JSON", () => {
        const indexStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/index.ifcx`).toString();
        const index = JSON.parse(indexStr) as IndexFileData;
        expect(index.header.ifcxVersion).to.equal("ifcx_post_alpha");
        expect(index.attributeTables.length).to.equal(4);
        expect(index.sections.length).to.equal(1);
    });

    it("Hello Wall Tiered NDJSON files are valid", () => {
        const meshStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/ifcx.geom.mesh.ndjson`).toString();
        const mesh = JSON.parse(meshStr.split("\n")[0]) as DisplayMesh;
        expect(mesh.points.length).to.be.greaterThan(0);
        expect(mesh.faceVertexIndices.length).to.be.greaterThan(0);

        const brepStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/ifcx.geom.brep.ndjson`).toString();
        const brep = JSON.parse(brepStr.split("\n")[0]) as BRepGeometry;
        expect(brep.format).to.equal("STEP_AP242");

        const procStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/ifcx.geom.proc.ndjson`).toString();
        const proc = JSON.parse(procStr.split("\n")[0]) as ProceduralHint;
        expect(proc.operation).to.equal("extrude");
    });

    it("Hello Wall Tiered loads with viewer config (mesh only)", () => {
        const indexStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/index.ifcx`).toString();
        const indexData = JSON.parse(indexStr) as IndexFileData;

        const ndjsonFiles = new Map<string, string>();
        for (const table of indexData.attributeTables) {
            const content = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/${table.filename}`).toString();
            ndjsonFiles.set(table.filename, content);
        }

        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh"]);
        expect(result.alphaFile.data.length).to.be.greaterThan(0);

        // Should have loaded mesh but not brep or proc
        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.mesh)).to.be.true;
        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.brep)).to.be.false;
        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.proc)).to.be.false;

        // Verify geometry node has mesh data
        const bodyNode = result.alphaFile.data.find(n =>
            n.attributes && n.attributes["usd::usdgeom::mesh::points"]
        );
        expect(bodyNode).to.exist;
    });
});
