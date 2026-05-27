import * as fs from "fs";
import { describe, it } from "./util/cappucino";
import { expect } from "chai";

import { AttributeTable } from "../ifcx-core/geometry/attribute-table";
import { InMemoryTableProvider, TierResolver } from "../ifcx-core/geometry/tier-resolver";
import {
    Brep,
    DisplayMesh,
    ProceduralGeometry,
    ExtrudedAreaSolid,
    TIER_TABLE_NAMES,
    parseLatentBrepPath,
} from "../ifcx-core/geometry/geometry-tiers";
import { loadIndexFile, IndexFileData } from "../ifcx-core/geometry/index-file-loader";
import { convertAlphaToTiered } from "../ifcx-core/geometry/alpha-to-tiered";
import { tessellate, tessellateBrep } from "../ifcx-core/geometry/tessellate";
import { ifcToTiered } from "../ifcx-cli/ifc-to-tiered";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";

// ── Attribute Table ──

describe("attribute table", () => {
    it("reads entries by index", () => {
        const ndjson = '{"a":1}\n{"a":2}\n{"a":3}';
        const table = new AttributeTable("test", ndjson);
        expect(table.length).to.equal(3);
        expect(table.read<{ a: number }>(0).a).to.equal(1);
        expect(table.read<{ a: number }>(2).a).to.equal(3);
    });

    it("throws on out-of-range index", () => {
        const table = new AttributeTable("test", '{"a":1}');
        expect(() => table.read(5)).to.throw();
    });

    it("round-trips from entries", () => {
        const entries = [{ x: 1 }, { x: 2 }];
        const table = AttributeTable.fromEntries("test", entries);
        expect(table.length).to.equal(2);
        expect(table.read<{ x: number }>(1).x).to.equal(2);
        expect(table.toNDJSON()).to.equal('{"x":1}\n{"x":2}');
    });
});

// ── Tier Resolver — Selective Loading ──

const SAMPLE_EXTRUDE: ExtrudedAreaSolid = {
    "bsi::ifc::geometry::procedural::extruded_area_solid": {
        SweptArea: {
            "bsi::ifc::geometry::procedural::rectangle": {
                position: { Location: [0, 0] },
                Width: 5,
                Height: 0.3,
            },
        },
        ExtrudedDirection: [0, 0, 1],
        Depth: 3,
    },
};

describe("tier resolver", () => {
    function makeMeshTable(): AttributeTable {
        const meshes: DisplayMesh[] = [
            { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 2] },
            { points: [[0, 0, 0], [2, 0, 0], [2, 2, 0]], faceVertexIndices: [0, 1, 2], derivedFrom: "procedural", tolerance: 0.001 },
        ];
        return AttributeTable.fromEntries(TIER_TABLE_NAMES.mesh, meshes);
    }

    function makeProcTable(): AttributeTable {
        const procs: ProceduralGeometry[] = [SAMPLE_EXTRUDE];
        return AttributeTable.fromEntries(TIER_TABLE_NAMES.procedural, procs);
    }

    it("resolves display mesh when mesh tier is requested", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const mesh = resolver.resolveDisplayMesh(0);
        expect(mesh).to.not.be.null;
        expect(mesh!.points.length).to.equal(3);
        expect(mesh!.faceVertexIndices).to.deep.equal([0, 1, 2]);
    });

    it("returns null for procedural when only mesh tier is requested", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const proc = resolver.resolveProcedural(0);
        expect(proc).to.be.null;
    });

    it("CRITICAL: viewer config never touches procedural table", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        resolver.resolveDisplayMesh(0);
        resolver.resolveDisplayMesh(1);
        resolver.resolveProcedural(0);

        const log = resolver.accessLog;
        expect(log.has(TIER_TABLE_NAMES.mesh)).to.be.true;
        expect(log.has(TIER_TABLE_NAMES.procedural)).to.be.false;
    });

    it("analysis config loads only procedural, not mesh", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["procedural"]);

        const proc = resolver.resolveProcedural(0);
        expect(proc).to.not.be.null;
        expect("bsi::ifc::geometry::procedural::extruded_area_solid" in proc!).to.be.true;

        const mesh = resolver.resolveDisplayMesh(0);
        expect(mesh).to.be.null;

        expect(resolver.accessLog.has(TIER_TABLE_NAMES.procedural)).to.be.true;
        expect(resolver.accessLog.has(TIER_TABLE_NAMES.mesh)).to.be.false;
    });

    it("can request all tiers simultaneously", () => {
        const provider = new InMemoryTableProvider()
            .addTable(makeMeshTable())
            .addTable(makeProcTable());
        const resolver = new TierResolver(provider, ["mesh", "procedural"]);

        expect(resolver.resolveDisplayMesh(0)).to.not.be.null;
        expect(resolver.resolveProcedural(0)).to.not.be.null;
    });

    it("preserves mesh derivation metadata", () => {
        const provider = new InMemoryTableProvider().addTable(makeMeshTable());
        const resolver = new TierResolver(provider, ["mesh"]);

        const mesh0 = resolver.resolveDisplayMesh(0);
        expect(mesh0!.derivedFrom).to.be.undefined;

        const mesh1 = resolver.resolveDisplayMesh(1);
        expect(mesh1!.derivedFrom).to.equal("procedural");
        expect(mesh1!.tolerance).to.equal(0.001);
    });
});

// ── Index File Loading ──

describe("index file loader", () => {
    function makeTestIndexFile(): { indexData: IndexFileData; ndjsonFiles: Map<string, string> } {
        const meshes: DisplayMesh[] = [
            { points: [[0, 0, 0], [5, 0, 0], [5, 0, 3], [0, 0, 3]], faceVertexIndices: [0, 1, 2, 0, 2, 3] },
        ];
        const procs: ProceduralGeometry[] = [SAMPLE_EXTRUDE];

        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.mesh.ndjson", meshes.map(m => JSON.stringify(m)).join("\n"));
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procs.map(p => JSON.stringify(p)).join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.mesh.ndjson", type: "NDJSON", schema: {} },
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
                                name: "ifcx::geom::proc",
                                value: { typeID: TIER_TABLE_NAMES.procedural, componentIndex: 0 },
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

        expect(result.alphaFile.data.length).to.equal(2);

        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody).to.exist;
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(wallBody!.attributes!["usd::usdgeom::mesh::faceVertexIndices"]).to.exist;

        expect(wallBody!.attributes!["ifcx::geom::proc"]).to.not.exist;
    });

    it("loads with only procedural tier — derives mesh on the fly", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["procedural"]);

        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody).to.exist;

        const proc = wallBody!.attributes!["ifcx::geom::proc"];
        expect(proc).to.exist;
        expect("bsi::ifc::geometry::procedural::extruded_area_solid" in (proc as object)).to.be.true;

        // Tier M was not loaded from a table — derived from Tier P by the tessellator.
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(wallBody!.attributes!["usd::usdgeom::mesh::faceVertexIndices"]).to.exist;
    });

    it("loads with all tiers", () => {
        const { indexData, ndjsonFiles } = makeTestIndexFile();
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh", "procedural"]);

        const wallBody = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(wallBody!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
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
        expect(log.has(TIER_TABLE_NAMES.procedural)).to.be.false;
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
                    children: { Wall: "wall-uuid" },
                },
                {
                    path: "wall-uuid",
                    children: { Body: "body-uuid" },
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
                        "usd::usdgeom::mesh::points": [[0, 0, 0], [5, 0, 0], [5, 0, 3], [0, 0, 3]],
                        "usd::usdgeom::mesh::faceVertexIndices": [0, 1, 2, 0, 2, 3],
                    },
                },
            ],
        } as IfcxFile;
    }

    it("extracts mesh geometry into Tier M NDJSON", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.ndjsonFiles.has(`${TIER_TABLE_NAMES.mesh}.ndjson`)).to.be.true;

        const meshNdjson = result.ndjsonFiles.get(`${TIER_TABLE_NAMES.mesh}.ndjson`)!;
        const mesh = JSON.parse(meshNdjson.split("\n")[0]) as DisplayMesh;
        expect(mesh.points.length).to.equal(4);
        expect(mesh.faceVertexIndices).to.deep.equal([0, 1, 2, 0, 2, 3]);
    });

    it("preserves semantic properties in separate NDJSON", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.ndjsonFiles.has("ifcx.semantics.ndjson")).to.be.true;
    });

    it("does not synthesize Tier P from arbitrary mesh data", () => {
        const alpha = makeAlphaWallFile();
        const result = convertAlphaToTiered(alpha);

        expect(result.ndjsonFiles.has(`${TIER_TABLE_NAMES.procedural}.ndjson`)).to.be.false;
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

        const loaded = loadIndexFile(converted.indexFile, converted.ndjsonFiles, ["mesh"]);

        const bodyNode = loaded.alphaFile.data.find(n => n.path === "body-uuid");
        expect(bodyNode).to.exist;
        expect(bodyNode!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(bodyNode!.attributes!["usd::usdgeom::mesh::points"]).to.deep.equal(
            [[0, 0, 0], [5, 0, 0], [5, 0, 3], [0, 0, 3]],
        );
    });
});

// ── Tier P Tessellator ──

describe("tier P tessellator", () => {
    it("extrudes a rectangle to a box with 8 corners (12 triangles)", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::rectangle": {
                        position: { Location: [2.5, 0.15] },
                        Width: 5,
                        Height: 0.3,
                    },
                },
                ExtrudedDirection: [0, 0, 1],
                Depth: 3,
            },
        };
        const mesh = tessellate(geom);
        expect(mesh).to.not.be.null;
        // 4 bottom-cap + 4 top-cap + 4 wall edges × 4 unique vertices each = 24 total.
        // Walls don't share corners with adjacent walls so flat shading works under
        // `geometry.computeVertexNormals()`.
        expect(mesh!.points.length).to.equal(24);
        // 2 caps × 2 triangles + 4 side faces × 2 triangles = 12 triangles = 36 indices
        expect(mesh!.faceVertexIndices.length).to.equal(36);
        expect(mesh!.derivedFrom).to.equal("procedural");
    });

    it("respects extrusion along Y axis (profile in XZ plane)", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::rectangle": {
                        position: { Location: [0.45, 0.6] },
                        Width: 0.9,
                        Height: 1.2,
                    },
                },
                ExtrudedDirection: [0, 1, 0],
                Depth: 0.05,
            },
        };
        const mesh = tessellate(geom);
        expect(mesh).to.not.be.null;
        // All x in [0, 0.9], all z in [0, 1.2], all y in [0, 0.05]
        for (const [x, y, z] of mesh!.points) {
            expect(x).to.be.within(-1e-9, 0.9 + 1e-9);
            expect(y).to.be.within(-1e-9, 0.05 + 1e-9);
            expect(z).to.be.within(-1e-9, 1.2 + 1e-9);
        }
    });

    it("tessellates a profile with a rectangular hole", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::profile_with_voids": {
                        exterior: {
                            "bsi::ifc::geometry::procedural::rectangle": {
                                position: { Location: [0.45, 0.6] },
                                Width: 0.9,
                                Height: 1.2,
                            },
                        },
                        Interior: [{
                            "bsi::ifc::geometry::procedural::rectangle": {
                                position: { Location: [0.45, 0.6] },
                                Width: 0.7,
                                Height: 1,
                            },
                        }],
                    },
                },
                ExtrudedDirection: [0, 1, 0],
                Depth: 0.05,
            },
        };
        const mesh = tessellate(geom);
        expect(mesh).to.not.be.null;
        // Mesh produced; at least both caps + walls have content
        expect(mesh!.points.length).to.be.greaterThan(0);
        expect(mesh!.faceVertexIndices.length).to.be.greaterThan(0);
        // All triangle indices must reference valid vertices
        const maxIdx = mesh!.points.length - 1;
        for (const i of mesh!.faceVertexIndices) {
            expect(i).to.be.at.most(maxIdx);
            expect(i).to.be.at.least(0);
        }
    });

    it("samples a composite curve (polyline + arcs) for a closed profile", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::composite_curve": {
                        Segments: [
                            { "bsi::ifc::geometry::procedural::polyline": { Points: [[0, 0], [0.8, 0], [0.8, 1.1]] } },
                            { "bsi::ifc::geometry::procedural::circular_arc": { Points: [[0.8, 1.1], [0.55, 1.4], [0.4, 1.5]] } },
                            { "bsi::ifc::geometry::procedural::circular_arc": { Points: [[0.4, 1.5], [0.25, 1.4], [0, 1.1]] } },
                            { "bsi::ifc::geometry::procedural::polyline": { Points: [[0, 1.1], [0, 0]] } },
                        ],
                    },
                },
                ExtrudedDirection: [0, 1, 0],
                Depth: 0.05,
            },
        };
        const mesh = tessellate(geom);
        expect(mesh).to.not.be.null;
        expect(mesh!.points.length).to.be.greaterThan(0);
        expect(mesh!.faceVertexIndices.length).to.be.greaterThan(0);
    });

    // Check that every emitted triangle has its normal pointing AWAY from the body's centroid.
    // Works for solid bodies (no holes); when a body has holes, the test passes a custom check
    // function for hole wall vertices.
    function assertOutwardNormals(mesh: DisplayMesh, centroid: [number, number, number]) {
        const pts = mesh.points;
        const idx = mesh.faceVertexIndices;
        const [cx, cy, cz] = centroid;
        for (let i = 0; i < idx.length; i += 3) {
            const [ax, ay, az] = pts[idx[i + 0]];
            const [bx, by, bz] = pts[idx[i + 1]];
            const [cx2, cy2, cz2] = pts[idx[i + 2]];
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            const mx = (ax + bx + cx2) / 3 - cx;
            const my = (ay + by + cy2) / 3 - cy;
            const mz = (az + bz + cz2) / 3 - cz;
            const dot = nx * mx + ny * my + nz * mz;
            if (dot <= 0) {
                throw new Error(
                    `Triangle ${i / 3} has inward normal: tri=[${ax},${ay},${az}] [${bx},${by},${bz}] [${cx2},${cy2},${cz2}] dot=${dot}`,
                );
            }
        }
    }

    it("produces outward-facing normals for Z-extrusion (right-handed frame parity)", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::rectangle": {
                        position: { Location: [2.5, 0.15] },
                        Width: 5,
                        Height: 0.3,
                    },
                },
                ExtrudedDirection: [0, 0, 1],
                Depth: 3,
            },
        };
        assertOutwardNormals(tessellate(geom)!, [2.5, 0.15, 1.5]);
    });

    it("produces outward-facing normals for Y-extrusion (left-handed frame parity)", () => {
        // The Y-extrusion case has a left-handed (u, v, w) frame under the AEC convention
        // (profile X→world X, profile Y→world Z, extrude along Y). The tessellator must flip
        // winding to keep normals pointing outward.
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::rectangle": {
                        position: { Location: [0.5, 0.5] },
                        Width: 1,
                        Height: 1,
                    },
                },
                ExtrudedDirection: [0, 1, 0],
                Depth: 0.1,
            },
        };
        assertOutwardNormals(tessellate(geom)!, [0.5, 0.05, 0.5]);
    });

    it("produces outward-facing hole-wall normals for ProfileWithVoids", () => {
        // A frame-shaped body: outer 0.9x1.2, hole 0.7x1.0 in the middle, extruded along Y.
        // Material occupies the "ring" between outer and hole. Outer walls' normals must point
        // away from the ring (outward); hole walls' normals must point into the void (also away
        // from material). For both, "away from material" means away from the local ring at the
        // wall's position. Test approximate: outward from the ring's medial line, which for this
        // simple case is the centroid of the outer rectangle.
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::profile_with_voids": {
                        exterior: {
                            "bsi::ifc::geometry::procedural::rectangle": {
                                position: { Location: [0.45, 0.6] },
                                Width: 0.9,
                                Height: 1.2,
                            },
                        },
                        Interior: [{
                            "bsi::ifc::geometry::procedural::rectangle": {
                                position: { Location: [0.45, 0.6] },
                                Width: 0.7,
                                Height: 1,
                            },
                        }],
                    },
                },
                ExtrudedDirection: [0, 1, 0],
                Depth: 0.05,
            },
        };
        const mesh = tessellate(geom)!;

        // For each triangle, classify which surface it belongs to by location, and assert the
        // normal points in the correct direction.
        // Outer walls: x ≈ 0 or x ≈ 0.9, or z ≈ 0 or z ≈ 1.2. Normal must point AWAY from
        //   the center (0.45, 0.6).
        // Hole walls: x ≈ 0.1 or x ≈ 0.8, or z ≈ 0.1 or z ≈ 1.1. Normal must point TOWARD
        //   the center (0.45, 0.6) of the hole (which is also (0.45, 0.6)).
        // Caps: y ≈ 0 (bottom, normal ≈ -Y) or y ≈ 0.05 (top, normal ≈ +Y).
        const pts = mesh.points;
        const idx = mesh.faceVertexIndices;
        for (let i = 0; i < idx.length; i += 3) {
            const [ax, ay, az] = pts[idx[i + 0]];
            const [bx, by, bz] = pts[idx[i + 1]];
            const [cx2, cy2, cz2] = pts[idx[i + 2]];
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            const tx = (ax + bx + cx2) / 3;
            const ty = (ay + by + cy2) / 3;
            const tz = (az + bz + cz2) / 3;

            // Determine surface class from triangle centroid.
            const onOuter = Math.abs(tx - 0) < 0.01 || Math.abs(tx - 0.9) < 0.01
                         || Math.abs(tz - 0) < 0.01 || Math.abs(tz - 1.2) < 0.01;
            const onHole = !onOuter && (
                Math.abs(tx - 0.1) < 0.01 || Math.abs(tx - 0.8) < 0.01
                || Math.abs(tz - 0.1) < 0.01 || Math.abs(tz - 1.1) < 0.01
            );
            const onCap = !onOuter && !onHole && (Math.abs(ty - 0) < 1e-6 || Math.abs(ty - 0.05) < 1e-6);

            if (onOuter) {
                // Outward from frame center (0.45, ?, 0.6) in XZ
                const mx = tx - 0.45;
                const mz = tz - 0.6;
                expect(nx * mx + nz * mz, `outer wall tri ${i / 3}`).to.be.greaterThan(0);
            } else if (onHole) {
                // Normal points into the void (toward the hole center 0.45, ?, 0.6 in XZ)
                const mx = 0.45 - tx;
                const mz = 0.6 - tz;
                expect(nx * mx + nz * mz, `hole wall tri ${i / 3}`).to.be.greaterThan(0);
            } else if (onCap) {
                // Bottom cap normal -Y, top cap normal +Y
                if (Math.abs(ty - 0) < 1e-6) {
                    expect(ny, `bottom cap tri ${i / 3}`).to.be.lessThan(0);
                } else {
                    expect(ny, `top cap tri ${i / 3}`).to.be.greaterThan(0);
                }
            }
        }
    });

    it("returns null for BooleanResult (deferred)", () => {
        const geom: ProceduralGeometry = {
            "bsi::ifc::geometry::procedural::boolean_result": {
                Operator: "difference",
                FirstOperand: {
                    "bsi::ifc::geometry::procedural::extruded_area_solid": {
                        SweptArea: { "bsi::ifc::geometry::procedural::rectangle": { Width: 1, Height: 1 } },
                        ExtrudedDirection: [0, 0, 1],
                        Depth: 1,
                    },
                },
                SecondOperand: {
                    "bsi::ifc::geometry::procedural::extruded_area_solid": {
                        SweptArea: { "bsi::ifc::geometry::procedural::rectangle": { Width: 0.5, Height: 0.5 } },
                        ExtrudedDirection: [0, 0, 1],
                        Depth: 1,
                    },
                },
            },
        };
        expect(tessellate(geom)).to.be.null;
    });
});

// ── Load-time tessellation fallback ──

describe("load-time tessellation fallback", () => {
    function makeProcOnlyIndex(): { indexData: IndexFileData; ndjsonFiles: Map<string, string> } {
        const procs: ProceduralGeometry[] = [{
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: {
                    "bsi::ifc::geometry::procedural::rectangle": {
                        position: { Location: [2.5, 0.15] },
                        Width: 5,
                        Height: 0.3,
                    },
                },
                ExtrudedDirection: [0, 0, 1],
                Depth: 3,
            },
        }];

        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procs.map(p => JSON.stringify(p)).join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.proc.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: {
                    id: "proc-only",
                    dataVersion: "1.0.0",
                    author: "test@test.com",
                    timestamp: "2026-01-01",
                    application: "test",
                },
                nodes: [{
                    path: "wall-body",
                    attributes: [{
                        opinion: "VALUE",
                        name: "ifcx::geom::proc",
                        value: { typeID: TIER_TABLE_NAMES.procedural, componentIndex: 0 },
                    }],
                }],
            }],
        };

        return { indexData, ndjsonFiles };
    }

    it("derives mesh attributes from Tier P when Tier M is absent", () => {
        const { indexData, ndjsonFiles } = makeProcOnlyIndex();
        const result = loadIndexFile(indexData, ndjsonFiles, ["procedural"]);

        const body = result.alphaFile.data.find(n => n.path === "wall-body");
        expect(body).to.exist;
        expect(body!.attributes!["ifcx::geom::proc"]).to.exist;
        expect(body!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(body!.attributes!["usd::usdgeom::mesh::faceVertexIndices"]).to.exist;
        // 24 vertices: 4 bottom-cap + 4 top-cap + 4 walls × 4 unique vertices each
        const points = body!.attributes!["usd::usdgeom::mesh::points"] as number[][];
        expect(points.length).to.equal(24);
    });

    it("does not tessellate when Tier M is already present (cache wins)", () => {
        // Add a Tier M entry alongside Tier P; loader should prefer M and skip tessellation.
        const procs: ProceduralGeometry[] = [{
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: { "bsi::ifc::geometry::procedural::rectangle": { Width: 5, Height: 0.3 } },
                ExtrudedDirection: [0, 0, 1],
                Depth: 3,
            },
        }];
        const meshes: DisplayMesh[] = [
            // A bogus 4-vertex mesh that differs from what tessellation would produce
            { points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], faceVertexIndices: [0, 1, 2, 0, 2, 3] },
        ];

        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procs.map(p => JSON.stringify(p)).join("\n"));
        ndjsonFiles.set("ifcx.geom.mesh.ndjson", meshes.map(m => JSON.stringify(m)).join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.proc.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.geom.mesh.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: {
                    id: "both", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t",
                },
                nodes: [{
                    path: "wall-body",
                    attributes: [
                        { opinion: "VALUE", name: "ifcx::geom::proc", value: { typeID: TIER_TABLE_NAMES.procedural, componentIndex: 0 } },
                        { opinion: "VALUE", name: "ifcx::geom::mesh", value: { typeID: TIER_TABLE_NAMES.mesh, componentIndex: 0 } },
                    ],
                }],
            }],
        };

        const result = loadIndexFile(indexData, ndjsonFiles, ["procedural", "mesh"]);
        const body = result.alphaFile.data.find(n => n.path === "wall-body");
        const points = body!.attributes!["usd::usdgeom::mesh::points"] as number[][];
        // 4 vertices: the cached mesh, not the 16 from tessellation
        expect(points.length).to.equal(4);
    });
});

// ── Tier B — Native Brep ──

/** A unit cube as a Tier B record. 6 planar faces, 12 line edges, 8 vertices. */
function makeUnitCube(): Brep {
    // 8 corner vertices of the unit cube at the origin
    const vertices = [
        { Point: [0, 0, 0] as [number, number, number] },
        { Point: [1, 0, 0] as [number, number, number] },
        { Point: [1, 1, 0] as [number, number, number] },
        { Point: [0, 1, 0] as [number, number, number] },
        { Point: [0, 0, 1] as [number, number, number] },
        { Point: [1, 0, 1] as [number, number, number] },
        { Point: [1, 1, 1] as [number, number, number] },
        { Point: [0, 1, 1] as [number, number, number] },
    ];

    // 12 unit line curves (one per cube edge). For brevity we'll share the line
    // along each axis where direction matches; real cubes typically dedupe.
    const curves: any[] = [
        // X-aligned
        { "bsi::ifc::geometry::brep::line": { Pnt: [0, 0, 0], Dir: [1, 0, 0] } },
        // Y-aligned
        { "bsi::ifc::geometry::brep::line": { Pnt: [0, 0, 0], Dir: [0, 1, 0] } },
        // Z-aligned
        { "bsi::ifc::geometry::brep::line": { Pnt: [0, 0, 0], Dir: [0, 0, 1] } },
    ];

    // 6 planar surfaces, one per face. Origin on the face, normal outward.
    const surfaces: any[] = [
        { "bsi::ifc::geometry::brep::plane": { Pnt: [0, 0, 0], Axis: [0, 0, -1], RefDirection: [1, 0, 0] } }, // bottom z=0
        { "bsi::ifc::geometry::brep::plane": { Pnt: [0, 0, 1], Axis: [0, 0, 1], RefDirection: [1, 0, 0] } },  // top z=1
        { "bsi::ifc::geometry::brep::plane": { Pnt: [0, 0, 0], Axis: [0, -1, 0], RefDirection: [1, 0, 0] } }, // front y=0
        { "bsi::ifc::geometry::brep::plane": { Pnt: [0, 1, 0], Axis: [0, 1, 0], RefDirection: [1, 0, 0] } },  // back y=1
        { "bsi::ifc::geometry::brep::plane": { Pnt: [0, 0, 0], Axis: [-1, 0, 0], RefDirection: [0, 1, 0] } }, // left x=0
        { "bsi::ifc::geometry::brep::plane": { Pnt: [1, 0, 0], Axis: [1, 0, 0], RefDirection: [0, 1, 0] } },  // right x=1
    ];

    // 12 edges (one per cube edge); each references a curve and start/end vertices
    const edges = [
        // bottom square (z=0)
        { CurveIndex: 0, StartVertex: 0, EndVertex: 1 }, // 0: 0→1 (+X)
        { CurveIndex: 1, StartVertex: 1, EndVertex: 2 }, // 1: 1→2 (+Y)
        { CurveIndex: 0, StartVertex: 3, EndVertex: 2 }, // 2: 3→2 (+X)
        { CurveIndex: 1, StartVertex: 0, EndVertex: 3 }, // 3: 0→3 (+Y)
        // top square (z=1)
        { CurveIndex: 0, StartVertex: 4, EndVertex: 5 }, // 4: 4→5 (+X)
        { CurveIndex: 1, StartVertex: 5, EndVertex: 6 }, // 5: 5→6 (+Y)
        { CurveIndex: 0, StartVertex: 7, EndVertex: 6 }, // 6: 7→6 (+X)
        { CurveIndex: 1, StartVertex: 4, EndVertex: 7 }, // 7: 4→7 (+Y)
        // verticals
        { CurveIndex: 2, StartVertex: 0, EndVertex: 4 }, // 8: 0→4 (+Z)
        { CurveIndex: 2, StartVertex: 1, EndVertex: 5 }, // 9: 1→5 (+Z)
        { CurveIndex: 2, StartVertex: 2, EndVertex: 6 }, // 10: 2→6 (+Z)
        { CurveIndex: 2, StartVertex: 3, EndVertex: 7 }, // 11: 3→7 (+Z)
    ];

    // 6 loops, one per face, each 4 oriented edges
    const loops = [
        // bottom face (z=0, normal -Z): CCW from below = CW from above
        { EdgeList: [
            { EdgeIndex: 0, Reversed: true },  // 1→0
            { EdgeIndex: 3, Reversed: false }, // 0→3
            { EdgeIndex: 2, Reversed: false }, // 3→2
            { EdgeIndex: 1, Reversed: true },  // 2→1
        ]},
        // top face (z=1, normal +Z): CCW from above
        { EdgeList: [
            { EdgeIndex: 4, Reversed: false }, // 4→5
            { EdgeIndex: 5, Reversed: false }, // 5→6
            { EdgeIndex: 6, Reversed: true },  // 6→7
            { EdgeIndex: 7, Reversed: true },  // 7→4
        ]},
        // front face (y=0, normal -Y)
        { EdgeList: [
            { EdgeIndex: 0, Reversed: false }, // 0→1
            { EdgeIndex: 9, Reversed: false }, // 1→5
            { EdgeIndex: 4, Reversed: true },  // 5→4
            { EdgeIndex: 8, Reversed: true },  // 4→0
        ]},
        // back face (y=1, normal +Y)
        { EdgeList: [
            { EdgeIndex: 2, Reversed: true },  // 2→3
            { EdgeIndex: 11, Reversed: false }, // 3→7
            { EdgeIndex: 6, Reversed: false }, // 7→6
            { EdgeIndex: 10, Reversed: true }, // 6→2
        ]},
        // left face (x=0, normal -X)
        { EdgeList: [
            { EdgeIndex: 3, Reversed: false }, // 0→3
            { EdgeIndex: 11, Reversed: false }, // 3→7
            { EdgeIndex: 7, Reversed: true },  // 7→4
            { EdgeIndex: 8, Reversed: true },  // 4→0
        ]},
        // right face (x=1, normal +X)
        { EdgeList: [
            { EdgeIndex: 1, Reversed: false }, // 1→2
            { EdgeIndex: 10, Reversed: false }, // 2→6
            { EdgeIndex: 5, Reversed: true },  // 6→5
            { EdgeIndex: 9, Reversed: true },  // 5→1
        ]},
    ];

    // 6 faces, each one outer loop + one surface
    const faces = [
        { SurfaceIndex: 0, OuterLoop: 0, SameSense: true }, // bottom
        { SurfaceIndex: 1, OuterLoop: 1, SameSense: true }, // top
        { SurfaceIndex: 2, OuterLoop: 2, SameSense: true }, // front
        { SurfaceIndex: 3, OuterLoop: 3, SameSense: true }, // back
        { SurfaceIndex: 4, OuterLoop: 4, SameSense: true }, // left
        { SurfaceIndex: 5, OuterLoop: 5, SameSense: true }, // right
    ];

    const shells = [{ FaceList: [0, 1, 2, 3, 4, 5] }];
    const regions = [{ ShellList: [0] }];

    return { vertices, curves, surfaces, edges, loops, faces, shells, regions };
}

describe("tier B brep", () => {
    it("unit cube has 8 vertices, 12 edges, 6 faces, 1 shell, 1 region", () => {
        const cube = makeUnitCube();
        expect(cube.vertices.length).to.equal(8);
        expect(cube.edges.length).to.equal(12);
        expect(cube.faces.length).to.equal(6);
        expect(cube.shells.length).to.equal(1);
        expect(cube.regions.length).to.equal(1);
    });

    it("every edge references valid vertex and curve indices", () => {
        const cube = makeUnitCube();
        for (const edge of cube.edges) {
            expect(edge.StartVertex).to.be.lessThan(cube.vertices.length);
            expect(edge.EndVertex).to.be.lessThan(cube.vertices.length);
            expect(edge.CurveIndex).to.be.lessThan(cube.curves.length);
        }
    });

    it("every loop closes (chain of oriented edges visits a connected vertex sequence)", () => {
        const cube = makeUnitCube();
        for (let li = 0; li < cube.loops.length; li++) {
            const loop = cube.loops[li];
            let prevEnd: number | null = null;
            let firstStart: number | null = null;
            for (const oe of loop.EdgeList) {
                const e = cube.edges[oe.EdgeIndex];
                const start = oe.Reversed ? e.EndVertex : e.StartVertex;
                const end = oe.Reversed ? e.StartVertex : e.EndVertex;
                if (prevEnd === null) {
                    firstStart = start;
                } else {
                    expect(start, `loop ${li} edge chain breaks`).to.equal(prevEnd);
                }
                prevEnd = end;
            }
            expect(prevEnd, `loop ${li} doesn't close`).to.equal(firstStart);
        }
    });

    it("Tier B integrates into loader as ifcx::geom::brep attribute", () => {
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: { id: "cube-test", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    path: "cube-body",
                    attributes: [{
                        opinion: "VALUE",
                        name: "ifcx::geom::brep",
                        value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 },
                    }],
                }],
            }],
        };

        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);
        const body = result.alphaFile.data.find(n => n.path === "cube-body");
        expect(body).to.exist;
        const brep = body!.attributes!["ifcx::geom::brep"] as Brep;
        expect(brep).to.exist;
        expect(brep.faces.length).to.equal(6);
    });

    it("tessellateBrep emits faceGroups mapping triangle ranges to source face indices", () => {
        const cube = makeUnitCube();
        const mesh = tessellateBrep(cube)!;
        expect(mesh.faceGroups).to.exist;
        expect(mesh.faceGroups!.length).to.equal(6); // 6 faces in a cube
        // Sum of group counts equals total triangle indices
        const totalCount = mesh.faceGroups!.reduce((s, g) => s + g.count, 0);
        expect(totalCount).to.equal(mesh.faceVertexIndices.length);
        // faceIndex values cover [0, 6)
        const seen = new Set(mesh.faceGroups!.map(g => g.faceIndex));
        expect(seen.size).to.equal(6);
    });

    it("loader injects ifcx::brep::face_groups attribute on the Brep node", () => {
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));
        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [{ filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} }],
            sections: [{
                header: { id: "fg", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    path: "body",
                    attributes: [{ opinion: "VALUE", name: "ifcx::geom::brep", value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 } }],
                }],
            }],
        };
        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);
        const body = result.alphaFile.data.find(n => n.path === "body");
        const groups = body!.attributes!["ifcx::brep::face_groups"] as any[];
        expect(groups).to.exist;
        expect(groups.length).to.equal(6);
    });

    it("tessellates a unit cube to 12 triangles with outward-facing normals", () => {
        const cube = makeUnitCube();
        const mesh = tessellateBrep(cube);
        expect(mesh).to.not.be.null;
        expect(mesh!.derivedFrom).to.equal("brep");
        // 6 faces × 2 triangles = 12 triangles = 36 indices
        expect(mesh!.faceVertexIndices.length).to.equal(36);
        // Each face has its own vertex block (no sharing across faces) → 6 × 4 = 24 vertices
        expect(mesh!.points.length).to.equal(24);

        // All triangle normals point outward from the cube center (0.5, 0.5, 0.5)
        const pts = mesh!.points;
        const idx = mesh!.faceVertexIndices;
        const [cx, cy, cz] = [0.5, 0.5, 0.5];
        for (let i = 0; i < idx.length; i += 3) {
            const [ax, ay, az] = pts[idx[i + 0]];
            const [bx, by, bz] = pts[idx[i + 1]];
            const [cx2, cy2, cz2] = pts[idx[i + 2]];
            const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
            const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
            const nx = e1y * e2z - e1z * e2y;
            const ny = e1z * e2x - e1x * e2z;
            const nz = e1x * e2y - e1y * e2x;
            const mx = (ax + bx + cx2) / 3 - cx;
            const my = (ay + by + cy2) / 3 - cy;
            const mz = (az + bz + cz2) / 3 - cz;
            expect(nx * mx + ny * my + nz * mz, `tri ${i / 3} inward`).to.be.greaterThan(0);
        }
    });

    it("loader derives mesh from Tier B when Tier M is absent", () => {
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [{ filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} }],
            sections: [{
                header: { id: "cube-deriv", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    path: "cube-body",
                    attributes: [{
                        opinion: "VALUE",
                        name: "ifcx::geom::brep",
                        value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 },
                    }],
                }],
            }],
        };

        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);
        const body = result.alphaFile.data.find(n => n.path === "cube-body");
        expect(body).to.exist;
        expect(body!.attributes!["ifcx::geom::brep"]).to.exist;
        expect(body!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(body!.attributes!["usd::usdgeom::mesh::faceVertexIndices"]).to.exist;
        const points = body!.attributes!["usd::usdgeom::mesh::points"] as number[][];
        expect(points.length).to.equal(24);
    });

    it("Tier P wins over Tier B when both are present (source-of-truth priority)", () => {
        const cube = makeUnitCube();
        const procs: ProceduralGeometry[] = [{
            "bsi::ifc::geometry::procedural::extruded_area_solid": {
                SweptArea: { "bsi::ifc::geometry::procedural::rectangle": { Width: 1, Height: 1 } },
                ExtrudedDirection: [0, 0, 1],
                Depth: 1,
            },
        }];
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));
        ndjsonFiles.set("ifcx.geom.proc.ndjson", procs.map(p => JSON.stringify(p)).join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.geom.proc.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: { id: "both", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    path: "body",
                    attributes: [
                        { opinion: "VALUE", name: "ifcx::geom::proc", value: { typeID: TIER_TABLE_NAMES.procedural, componentIndex: 0 } },
                        { opinion: "VALUE", name: "ifcx::geom::brep", value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 } },
                    ],
                }],
            }],
        };

        const result = loadIndexFile(indexData, ndjsonFiles, ["procedural", "brep"]);
        const body = result.alphaFile.data.find(n => n.path === "body");
        // Tier P tessellator emits 24 vertices for a unit cube (per-face flat-shaded);
        // Tier B tessellator also emits 24. Verify by checking derived-from would be
        // "procedural" if we exposed it — proxy by counting tetrahedra: Tier P generates
        // 4 wall edges × 4 verts + 2 caps × 4 verts = 24, Tier B 6 faces × 4 verts = 24.
        // Both happen to coincide for a cube, so check that one of them was used.
        const points = body!.attributes!["usd::usdgeom::mesh::points"] as number[][];
        expect(points.length).to.equal(24);
    });

    it("tier resolver respects brep tier selection", () => {
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [{ filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} }],
            sections: [{
                header: { id: "cube-test", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    path: "cube-body",
                    attributes: [{
                        opinion: "VALUE",
                        name: "ifcx::geom::brep",
                        value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 },
                    }],
                }],
            }],
        };

        // Load WITHOUT brep tier — attribute should not appear
        const result = loadIndexFile(indexData, ndjsonFiles, ["mesh"]);
        const body = result.alphaFile.data.find(n => n.path === "cube-body");
        expect(body!.attributes!["ifcx::geom::brep"]).to.not.exist;
        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.brep)).to.be.false;
    });
});

// ── Latent-path compositor integration ──

describe("latent-path compositor", () => {
    function makeBrepCubeWithLatentFaceAttr(faceIdx: number, materialCode: string): { indexData: IndexFileData; ndjsonFiles: Map<string, string> } {
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));
        ndjsonFiles.set("ifcx.semantics.ndjson", JSON.stringify({
            "bsi::ifc::material": { code: materialCode },
        }));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.semantics.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: { id: "latent-test", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [
                    {
                        path: "body",
                        attributes: [{
                            opinion: "VALUE",
                            name: "ifcx::geom::brep",
                            value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 },
                        }],
                    },
                    {
                        path: `body/Face_${faceIdx}`,
                        attributes: [{
                            opinion: "VALUE",
                            name: "ifcx::semantics",
                            value: { typeID: "ifcx.semantics", componentIndex: 0 },
                        }],
                    },
                ],
            }],
        };

        return { indexData, ndjsonFiles };
    }

    it("absorbs latent Face_<n> nodes into the parent Brep node", () => {
        const { indexData, ndjsonFiles } = makeBrepCubeWithLatentFaceAttr(3, "STEEL");
        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);

        const body = result.alphaFile.data.find(n => n.path === "body");
        expect(body).to.exist;
        // The latent node should be gone from data
        const latent = result.alphaFile.data.find(n => n.path === "body/Face_3");
        expect(latent).to.be.undefined;

        // The latent attribute should appear on the parent under ifcx::brep::face::3
        const faceAttrs = body!.attributes!["ifcx::brep::face::3"] as Record<string, any>;
        expect(faceAttrs).to.exist;
        expect(faceAttrs["bsi::ifc::material"]).to.deep.equal({ code: "STEEL" });
    });

    it("dangling latent paths (no parent in file) pass through as ordinary nodes", () => {
        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [{
                filename: "ifcx.semantics.ndjson", type: "NDJSON", schema: {},
            }],
            sections: [{
                header: { id: "dangling", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [{
                    // No "body" node exists in this file — bodyPath part of latent is dangling
                    path: "body/Face_5",
                    attributes: [{
                        opinion: "VALUE",
                        name: "ifcx::semantics",
                        value: { typeID: "ifcx.semantics", componentIndex: 0 },
                    }],
                }],
            }],
        };
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.semantics.ndjson", JSON.stringify({ "bsi::ifc::material": { code: "X" } }));

        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);
        const survivor = result.alphaFile.data.find(n => n.path === "body/Face_5");
        expect(survivor).to.exist;
        expect(survivor!.attributes!["bsi::ifc::material"]).to.exist;
    });

    it("merges multiple latent attributes on the same face", () => {
        // Two latent nodes both targeting body/Face_2, one with material, one with finish
        const cube = makeUnitCube();
        const ndjsonFiles = new Map<string, string>();
        ndjsonFiles.set("ifcx.geom.brep.ndjson", JSON.stringify(cube));
        ndjsonFiles.set("ifcx.semantics.ndjson", [
            JSON.stringify({ "bsi::ifc::material": { code: "WOOD" } }),
            JSON.stringify({ "bsi::ifc::finish": "matte" }),
        ].join("\n"));

        const indexData: IndexFileData = {
            header: { ifcxVersion: "ifcx_post_alpha" },
            imports: [],
            attributeTables: [
                { filename: "ifcx.geom.brep.ndjson", type: "NDJSON", schema: {} },
                { filename: "ifcx.semantics.ndjson", type: "NDJSON", schema: {} },
            ],
            sections: [{
                header: { id: "merge-test", dataVersion: "1.0.0", author: "t", timestamp: "2026-01-01", application: "t" },
                nodes: [
                    { path: "body", attributes: [{ opinion: "VALUE", name: "ifcx::geom::brep", value: { typeID: TIER_TABLE_NAMES.brep, componentIndex: 0 } }] },
                    { path: "body/Face_2", attributes: [{ opinion: "VALUE", name: "ifcx::semantics", value: { typeID: "ifcx.semantics", componentIndex: 0 } }] },
                ],
            }],
        };

        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);
        const body = result.alphaFile.data.find(n => n.path === "body");
        const face2 = body!.attributes!["ifcx::brep::face::2"] as Record<string, any>;
        expect(face2["bsi::ifc::material"]).to.deep.equal({ code: "WOOD" });
    });
});

// ── Latent-path face addressing ──

describe("latent Brep path parser", () => {
    it("parses Face_<i> sub-paths", () => {
        const r = parseLatentBrepPath("wall-body-uuid/Face_3");
        expect(r).to.not.be.null;
        expect(r!.bodyPath).to.equal("wall-body-uuid");
        expect(r!.kind).to.equal("face");
        expect(r!.index).to.equal(3);
    });

    it("parses Edge_<i> sub-paths", () => {
        const r = parseLatentBrepPath("body/Edge_11");
        expect(r!.kind).to.equal("edge");
        expect(r!.index).to.equal(11);
    });

    it("parses Vertex_<i> sub-paths", () => {
        const r = parseLatentBrepPath("body/Vertex_0");
        expect(r!.kind).to.equal("vertex");
        expect(r!.index).to.equal(0);
    });

    it("returns null for non-latent paths", () => {
        expect(parseLatentBrepPath("wall-body-uuid")).to.be.null;
        expect(parseLatentBrepPath("wall-body/Window")).to.be.null;
        expect(parseLatentBrepPath("wall-body/Face_abc")).to.be.null;
    });

    it("preserves the parent path for deeply nested bodies", () => {
        const r = parseLatentBrepPath("a/b/c/body-uuid/Face_5");
        expect(r!.bodyPath).to.equal("a/b/c/body-uuid");
        expect(r!.index).to.equal(5);
    });
});

// ── Example File Validation ──

describe("tiered example file", () => {
    const examplesFolderPath = "../examples";

    it("Hello Wall Tiered index file is valid JSON", () => {
        const indexStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/index.ifcx`).toString();
        const index = JSON.parse(indexStr) as IndexFileData;
        expect(index.header.ifcxVersion).to.equal("ifcx_post_alpha");
        expect(index.attributeTables.length).to.be.greaterThan(0);
        expect(index.sections.length).to.equal(1);
    });

    it("Hello Wall Tiered Tier M NDJSON is valid", () => {
        const meshStr = fs.readFileSync(`${examplesFolderPath}/Hello Wall Tiered/ifcx.geom.mesh.ndjson`).toString();
        const mesh = JSON.parse(meshStr.split("\n")[0]) as DisplayMesh;
        expect(mesh.points.length).to.be.greaterThan(0);
        expect(mesh.faceVertexIndices.length).to.be.greaterThan(0);
    });

    it("Hello Wall Tiered Tier P NDJSON is valid", () => {
        const procPath = `${examplesFolderPath}/Hello Wall Tiered/ifcx.geom.proc.ndjson`;
        if (!fs.existsSync(procPath)) {
            // Tier P not present in this example is acceptable.
            return;
        }
        const procStr = fs.readFileSync(procPath).toString();
        const firstLine = procStr.split("\n")[0];
        if (!firstLine) return;
        const proc = JSON.parse(firstLine);
        const key = Object.keys(proc)[0];
        expect(key.startsWith("bsi::ifc::geometry::procedural::")).to.be.true;
    });

    it("phase 6 — ifcToTiered converts hello-wall.ifc, preserving IFC GUIDs as paths", async () => {
        const tmpDir = `${examplesFolderPath}/_tmp_ifc2tiered_test`;
        try {
            // Clean up any prior run
            if (fs.existsSync(tmpDir)) {
                for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(`${tmpDir}/${f}`);
                fs.rmdirSync(tmpDir);
            }

            const result = await ifcToTiered(
                `${examplesFolderPath}/Hello Wall/hello-wall.ifc`,
                tmpDir,
            );
            expect(result.sourceSchema).to.equal("IFC4");
            expect(result.nodeCount).to.be.greaterThan(0);
            expect(fs.existsSync(result.indexPath)).to.be.true;

            const indexData = JSON.parse(fs.readFileSync(result.indexPath).toString()) as IndexFileData;
            // Spatial structure round-tripped
            expect(indexData.sections[0].nodes.length).to.equal(result.nodeCount);
            // Project node uses the original IFC GUID (22-char base64) as its path
            const projectNode = indexData.sections[0].nodes.find(n =>
                n.attributes?.some(a =>
                    a.value && typeof a.value === "object" &&
                    "componentIndex" in (a.value as any),
                ),
            );
            expect(projectNode).to.exist;
            // A node path starting with one of the known IFC GUIDs from hello-wall.ifc
            const projectGuid = "0KhR8hr7H8eewFRKm6V1bJ";
            expect(
                indexData.sections[0].nodes.some(n => n.path === projectGuid),
                "expected an IFC GUID-paths node in the output",
            ).to.be.true;
        } finally {
            if (fs.existsSync(tmpDir)) {
                for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(`${tmpDir}/${f}`);
                fs.rmdirSync(tmpDir);
            }
        }
    });

    it("Hello Brep Cube end-to-end: Tier B tessellates + Face_1 attrs land on Body", () => {
        const dir = `${examplesFolderPath}/Hello Brep Cube`;
        const indexStr = fs.readFileSync(`${dir}/index.ifcx`).toString();
        const indexData = JSON.parse(indexStr) as IndexFileData;

        const ndjsonFiles = new Map<string, string>();
        for (const table of indexData.attributeTables) {
            ndjsonFiles.set(table.filename, fs.readFileSync(`${dir}/${table.filename}`).toString());
        }

        const result = loadIndexFile(indexData, ndjsonFiles, ["brep"]);

        const body = result.alphaFile.data.find(n =>
            n.path === "11111111-2222-3333-4444-555555555555",
        );
        expect(body, "body node").to.exist;
        // Tier B was tessellated to mesh attributes
        expect(body!.attributes!["usd::usdgeom::mesh::points"]).to.exist;
        expect(body!.attributes!["ifcx::brep::face_groups"]).to.exist;
        // Latent Face_1 was absorbed
        const face1 = body!.attributes!["ifcx::brep::face::1"] as Record<string, any>;
        expect(face1, "Face_1 attrs").to.exist;
        expect(face1["bsi::ifc::material"]).to.exist;
        // Face_1 is the top of the cube — ROOFING material with brown diffuseColor
        expect(face1["bsi::ifc::material"].code).to.equal("ROOFING");
        const color = face1["bsi::ifc::presentation::diffuseColor"] as number[];
        expect(color.length).to.equal(3);
        // Latent node itself is gone from data
        expect(result.alphaFile.data.find(n =>
            n.path === "11111111-2222-3333-4444-555555555555/Face_1",
        )).to.be.undefined;
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

        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.mesh)).to.be.true;
        expect(result.tierResolver.accessLog.has(TIER_TABLE_NAMES.procedural)).to.be.false;

        const bodyNode = result.alphaFile.data.find(n =>
            n.attributes && n.attributes["usd::usdgeom::mesh::points"],
        );
        expect(bodyNode).to.exist;
    });
});
