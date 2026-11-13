import * as fs from "fs";
import { createHash } from "crypto";

import { describe, it } from "./util/cappucino";
import { expect } from "chai";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";
import { InMemoryLayerProvider, StackedLayerProvider } from "../ifcx-core/layers/layer-providers";
import { FetchLayerProvider } from "../ifcx-core/layers/fetch-layer-provider";
import { IfcxLayerStackBuilder } from "../ifcx-core/layers/layer-stack";
import { PostCompositionNode } from "../ifcx-core/composition/node";

let examplesFolderPath = "../examples"

describe("example file", () => {
    it("hello wall validates properly", async () => {
        let file = JSON.parse(fs.readFileSync(`${examplesFolderPath}/Hello Wall/hello-wall.ifcx`).toString()) as IfcxFile;
        
        let provider = new StackedLayerProvider([
            new InMemoryLayerProvider().AddAll([file]), 
            new FetchLayerProvider()
        ]);

        let layerStack = await (new IfcxLayerStackBuilder(provider).FromId(file.header.id)).Build();
        expect(layerStack instanceof Error).to.be.false;
    });
    it("signals validates properly", async () => {
        let file = JSON.parse(fs.readFileSync(`${examplesFolderPath}/Linear placement of signals/linear-placement-of-signal.ifcx`).toString()) as IfcxFile;
       
        let provider = new StackedLayerProvider([
            new InMemoryLayerProvider().AddAll([file]), 
            new FetchLayerProvider()
        ]);

        let layerStack = await (new IfcxLayerStackBuilder(provider).FromId(file.header.id)).Build();
        expect(layerStack instanceof Error).to.be.false;
    });
    it("timber junction composes v1 and v2 layer stacks", async () => {
        const v1 = await ComposeTimberJunction(timberJunctionV1);
        const v2 = await ComposeTimberJunction(timberJunctionV2);

        // Per-occurrence rows of the "Composed occurrences" table in the README.
        expect(OccurrenceSummaries(v1)).to.deep.equal({
            Wand_1__Decke: "D012/v3 approved", Wand_2__Decke: "D012/v3 in-review",
            Wand_3__Decke: "D021/v1 approved", Wand_4__Decke: "-",
            Decke__Balkonplatte_A: "D031/v1 approved", Decke__Balkonplatte_B: "D031/v1 in-review" });
        expect(OccurrenceSummaries(v2)).to.deep.equal({
            Wand_1_1__Decke: "D012/v3 to-confirm split c876b170", Wand_1_2__Decke: "D012/v3 to-confirm split c876b170",
            Wand_2__Decke: "D012/v3 in-review identity d5a65e9f", Wand_3__Decke: "D021/v1 to-confirm", Wand_4__Decke: "-",
            Decke__Balkonplatte: "D031/v1 to-confirm merge 29fc8807+efea72a9" });

        // Known gap: v1 assignments whose occurrence was not re-derived compose as member-less roots.
        const orphans = [...v2.children.values()].filter(n =>
            n.attributes.has("dokwood::detail::assignment") && !n.attributes.has("dokwood::detail::members"));
        const derivedV2 = new Set(ReadTimberJunction("3-derivation-v2").data.map(d => d.path));
        const notRederived = ReadTimberJunction("4-assignment-v1").data.map(d => d.path).filter(p => !derivedV2.has(p));
        expect(orphans.map(n => n.node).sort()).to.deep.equal(notRederived.sort());
        expect(orphans.map(Summary).sort()).to.deep.equal(["D012/v3 approved", "D012/v3 in-review", "D031/v1 approved", "D031/v1 in-review"]);
        const carriedFrom = ReadTimberJunction("4-assignment-v2").data.flatMap(d => d.attributes!["dokwood::detail::assignment"].carriedFrom?.occurrences ?? []);
        expect([...new Set(carriedFrom)].sort()).to.deep.equal(notRederived.sort());
    });
    it("timber junction approvals hold only for the derivation they reviewed", async () => {
        // The rule, which IFCX does not enforce: approved needs reviewedSha256 equal to the hash of the
        // occurrence's derivation record, and a different reviewedSha256 needs to-confirm.
        const check = async (stack: string[]) => {
            const approved: string[] = [], stale: string[] = [];
            for (const [name, o] of OccurrenceNodes(await ComposeTimberJunction(stack))) {
                const a = o.attributes.get("dokwood::detail::assignment");
                if (!a) continue;
                const current = RecordSha(o.attributes.get("dokwood::derivation"));
                if (a.state === "approved") {
                    expect(a.reviewedSha256, name).to.equal(current);
                    approved.push(name);
                }
                if (a.reviewedSha256 && a.reviewedSha256 !== current) {
                    expect(a.state, name).to.equal("to-confirm");
                    stale.push(name);
                }
            }
            return { approved, stale };
        };
        expect(await check(timberJunctionV1)).to.deep.equal({ approved: ["Wand_1__Decke", "Wand_3__Decke", "Decke__Balkonplatte_A"], stale: [] });
        // Wand 3 kept its path, but its derivation record names model v2 now, so its v1 approval is stale.
        expect(await check(timberJunctionV2)).to.deep.equal({ approved: [], stale: ["Wand_1_1__Decke", "Wand_1_2__Decke", "Wand_3__Decke"] });
    });
    it("timber junction layer order decides the Wand 3 review state", async () => {
        // Exactly one attribute is written on the same path by two layers of the v2 stack.
        const writes = timberJunctionV2.flatMap(layer => ReadTimberJunction(layer).data
            .flatMap(d => Object.keys(d.attributes ?? {}).map(attr => `${d.path} ${attr}`)));
        const twice = writes.filter((w, i) => writes.indexOf(w) !== i);
        const wand3 = OccurrencePath("v1", "Wand_3__Decke");
        expect(twice).to.deep.equal([`${wand3} dokwood::detail::assignment`]);
        // The later layer wins: as committed 4-assignment-v2 comes last and says to-confirm.
        const forward = OccurrenceSummaries(await ComposeTimberJunction(timberJunctionV2));
        const swapped = OccurrenceSummaries(await ComposeTimberJunction(
            [...timberJunctionV2.filter(n => n !== "4-assignment-v1"), "4-assignment-v1"]));
        expect([forward.Wand_3__Decke, swapped.Wand_3__Decke]).to.deep.equal(["D021/v1 to-confirm", "D021/v1 approved"]);
        expect({ ...swapped, Wand_3__Decke: forward.Wand_3__Decke }).to.deep.equal(forward);
    });
    it("timber junction lineages and derivations are bound to the model files", () => {
        const sha = (file: string) => createHash("sha256").update(fs.readFileSync(`${timberJunctionPath}/${file}`)).digest("hex");
        const binding = (v: string) => ({ layer: ReadTimberJunction(`1-model-${v}`).header.id, sha256: sha(`1-model-${v}.ifcx`) });
        for (const head of ["v2", "v2-samename"]) {
            const lineage = LineageOf(`4-lineage-v1-${head}`);
            expect(lineage.base).to.deep.equal(binding("v1"));
            expect(lineage.head).to.deep.equal(binding(head));
            // The entries come from an ifc-lite sidecar, itself bound to the STEP twins it diffed.
            expect(lineage.sidecar).to.deep.equal({ file: `ifc-lite/lineage-v1-${head}.json`, sha256: sha(lineage.sidecar.file) });
            const sidecar = JSON.parse(fs.readFileSync(`${timberJunctionPath}/${lineage.sidecar.file}`).toString());
            expect([sidecar.base.hash, sidecar.head.hash]).to.deep.equal(["v1", head].map(v => `sha256:${sha(`ifc-lite/model-${v}.ifc`)}`));
            // Copied verbatim, with each GlobalId turned into its IFCX path, which is a node of that model.
            const [base, tip] = [ElementPathIn("v1"), ElementPathIn(head)];
            expect(lineage.entries.map((e: any) => [e.predecessors, e.successors, e.relation, e.evidence, e.shares, e.source]))
                .to.deep.equal(sidecar.entries.map((e: any) => [e.base.map(base), e.head.map(tip), e.relation, e.reason, e.shares, "ifc-lite"]));
        }
        for (const v of ["v1", "v2"]) {
            const group = OccurrenceGroup(v);
            const occurrences = ReadTimberJunction(`3-derivation-${v}`).data.filter(d => d.path !== group.path);
            expect(occurrences.map(d => d.path).sort()).to.deep.equal(Object.values(group.children!).sort());
            const expected = binding(v);
            for (const d of occurrences) {
                const derivation = d.attributes!["dokwood::derivation"];
                expect({ layer: derivation.sourceLayer, sha256: derivation.sourceSha256 }).to.deep.equal(expected);
            }
        }
    });
    it("timber junction carries merges by same-type-or-none", async () => {
        const merges = LineageOf("4-lineage-v1-v2").entries.filter((e: any) => e.relation === "merge");
        expect(merges.map((e: any) => [e.predecessors, e.successors, e.evidence, e.shares])).to.deep.equal([[
            ["1BalkonplatteTeilA0001", "1BalkonplatteTeilB0001"].map(PathOf), [PathOf("2BalkonplatteGanz00001")],
            "merge:verified", [0.5, 0.5]]]);
        const bySubject = async (stack: string[]) => new Map([...OccurrenceNodes(await ComposeTimberJunction(stack)).values()]
            .map(o => [o.attributes.get("dokwood::detail::members").find((m: any) => m.ref !== slabPath).ref, o]));
        const [v1, v2] = [await bySubject(timberJunctionV1), await bySubject(timberJunctionV2)];
        for (const merge of merges) {
            const before: PostCompositionNode[] = merge.predecessors.map((p: string) => v1.get(p)!);
            const after = v2.get(merge.successors[0])!;
            // The merged occurrence gets the type only if every predecessor had the same one, and is to be confirmed.
            const types = new Set(before.map(o => o.attributes.has("dokwood::detail::assignment") ? Summary(o).split(" ")[0] : "-"));
            const agreed = types.size === 1 && !types.has("-");
            expect(after.attributes.get("dokwood::detail::assignment")).to.deep.equal(!agreed ? undefined : { state: "to-confirm",
                carriedFrom: { occurrences: before.map(o => o.node), lineage: LineageNode("4-lineage-v1-v2").path,
                               relation: "merge", policy: "same-type-or-none" } });
            expect(Summary(after).split(" ")[0]).to.equal(agreed ? [...types][0] : "-");
        }
        // The balcony is the agreeing case: D031/v1 approved and D031/v1 in-review.
        expect(merges[0].predecessors.map((p: string) => Summary(v1.get(p)!))).to.deep.equal(["D031/v1 approved", "D031/v1 in-review"]);
    });
    it("timber junction: ifc-lite misses a split whose pieces keep the old name, a manual entry states it", async () => {
        const root = await ComposeTimberJunction(timberJunctionSameName);
        const entries = [...root.children.values()].flatMap(n => n.attributes.get("dokwood::lineage")?.entries ?? []);
        const [w1, w1a, w1b] = ["1WandW1altAussenwand01", "2WandW1aNeuTeilstueckA", "2WandW1bNeuTeilstueckB"].map(PathOf);
        // ifc-lite pairs Wand 1 with the larger piece as reshaped, and the smaller piece is in no entry.
        const ifcLite = entries.filter((e: any) => e.source === "ifc-lite");
        expect(ifcLite.filter((e: any) => e.predecessors.includes(w1))).to.deep.equal([{ predecessors: [w1], successors: [w1a],
            relation: "identity", evidence: "content-match:reshaped", source: "ifc-lite" }]);
        expect(ifcLite.some((e: any) => e.successors.includes(w1b))).to.be.false;
        const manual = entries.filter((e: any) => e.source === "manual");
        expect(manual).to.deep.equal([{ predecessors: [w1], successors: [w1a, w1b], relation: "split",
            evidence: "manual:checked-against-plan", source: "manual",
            author: "planner (manual review in detail editor)", timestamp: "2026-11-13T10:30:00Z" }]);
        // With the manual entry in place of the ifc-lite one, every element new in v2 has a predecessor.
        const effective = EffectiveLineage(entries);
        expect(effective.filter(e => e.predecessors.includes(w1))).to.deep.equal(manual);
        const inV1 = new Set(ModelElements("v1").map(d => d.path));
        const added = ModelElements("v2-samename").map(d => d.path).filter(p => !inV1.has(p));
        expect(added.filter(p => !effective.some(e => e.successors.includes(p)))).to.deep.equal([]);
        expect(added.filter(p => !ifcLite.some((e: any) => e.successors.includes(p)))).to.deep.equal([w1b]);
    });
    it("timber junction manual split of the Wand 2 occurrence is orphaned when Wand 2 is re-derived", async () => {
        const parts = (o: PostCompositionNode) => [...o.children].map(([name, p]) => {
            const { start, end } = p.attributes.get("dokwood::detail::topology").extent;
            return [name, start[0], end[0], p.attributes.get("dokwood::detail::members")[0].ref];
        });
        const oldWall = PathOf("1WandW2altAussenwand02");
        const split = [["Teil_1", 0, 2.5, oldWall], ["Teil_2", 3.5, 6, oldWall]];
        const v1 = await ComposeTimberJunction(timberJunctionV1);
        const v2 = await ComposeTimberJunction(timberJunctionV2);
        const before = OccurrenceNodes(v1).get("Wand_2__Decke")!;
        expect(before.attributes.has("dokwood::detail::manualSplit")).to.be.true;
        expect(parts(before)).to.deep.equal(split);
        // The re-derived Wand 2 occurrence has a new path and none of the split.
        const after = OccurrenceNodes(v2).get("Wand_2__Decke")!;
        expect(after.node).to.not.equal(before.node);
        expect([after.children.size, after.attributes.has("dokwood::detail::manualSplit")]).to.deep.equal([0, false]);
        // The split stays on the old path: a root with no members, its parts naming a wall model v2 does not have.
        const orphan = v2.children.get(before.node)!;
        expect(orphan.attributes.has("dokwood::detail::members")).to.be.false;
        expect(parts(orphan)).to.deep.equal(split);
        expect(ModelElements("v2").map(d => d.path)).to.not.include(oldWall);
    });
    it("timber junction STEP twins match the IFCX models", () => {
        for (const v of ["v1", "v2", "v2-samename"]) {
            expect(StepElements(v), v).to.deep.equal(IfcxElements(v));
        }
    });
});

const timberJunctionPath = `${examplesFolderPath}/Timber Junction`;
const timberJunctionV1 = ["1-model-v1", "2-catalog", "3-derivation-v1", "4-assignment-v1", "4-manual-split"];
const timberJunctionV2 = ["1-model-v2", "2-catalog", "3-derivation-v2", "4-assignment-v1", "4-manual-split", "4-lineage-v1-v2", "4-assignment-v2"];
const timberJunctionSameName = ["1-model-v2-samename", "4-lineage-v1-v2-samename", "4-lineage-v1-v2-samename-manual"];
// One provider for all composes, so the ifcx.dev imports are fetched once per run.
const fetchProvider = new FetchLayerProvider();

function ReadTimberJunction(name: string)
{
    return JSON.parse(fs.readFileSync(`${timberJunctionPath}/${name}.ifcx`).toString()) as IfcxFile;
}

// Same stacking as `ifcx compose`: later files win.
async function ComposeTimberJunction(names: string[])
{
    const files = names.map(ReadTimberJunction);
    const order: IfcxFile = {
        header: { ...files[0].header, id: "timber-junction-stack" },
        imports: files.map(f => ({ uri: f.header.id })),
        schemas: {},
        data: []
    };
    const provider = new StackedLayerProvider([
        new InMemoryLayerProvider().AddAll([order, ...files]),
        fetchProvider
    ]);
    const layerStack = await (new IfcxLayerStackBuilder(provider).FromId(order.header.id)).Build();
    if (layerStack instanceof Error) throw layerStack;
    return layerStack.GetFullTree();
}

// uuid5 as in generate.py: an element's IFCX path is uuid5(ns, "element|<GlobalId>").
function Uuid5(namespace: string, name: string)
{
    const h = createHash("sha1").update(Buffer.from(namespace.replace(/-/g, ""), "hex")).update(name).digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString("hex");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const timberJunctionNs = Uuid5("6ba7b811-9dad-11d1-80b4-00c04fd430c8", "dokwood.example/timber-junction");
const PathOf = (gid: string) => Uuid5(timberJunctionNs, `element|${gid}`);
const slabPath = PathOf("1DeckeUeberEGStabil001");

function ModelElements(v: string)
{
    return ReadTimberJunction(`1-model-${v}`).data.filter(d => ["IfcWall", "IfcSlab"].includes(d.attributes?.["bsi::ifc::class"]?.code));
}

function ElementPathIn(v: string)
{
    const paths = new Set(ModelElements(v).map(d => d.path));
    return (gid: string) => {
        expect(paths.has(PathOf(gid)), `${gid} in 1-model-${v}.ifcx`).to.be.true;
        return PathOf(gid);
    };
}

function LineageNode(name: string)
{
    return ReadTimberJunction(name).data.find(d => d.attributes?.["dokwood::lineage"])!;
}

function LineageOf(name: string)
{
    return LineageNode(name).attributes!["dokwood::lineage"];
}

const occurrenceGroupName = "Detail occurrences (derived)";

function OccurrenceGroup(v: string)
{
    const group = ReadTimberJunction(`3-derivation-${v}`).data.find(d => d.attributes?.["bsi::ifc::prop::Name"] === occurrenceGroupName);
    if (!group) throw new Error(`No node named "${occurrenceGroupName}" in 3-derivation-${v}`);
    return group;
}

function OccurrencePath(v: string, name: string)
{
    return OccurrenceGroup(v).children![name];
}

// Convention of this example, not IFCX: a manual entry replaces every ifc-lite entry that names one of its elements.
function EffectiveLineage(entries: any[])
{
    const elements = (e: any): string[] => [...e.predecessors, ...e.successors];
    const manual = entries.filter(e => e.source === "manual");
    const named = new Set(manual.flatMap(elements));
    return [...manual, ...entries.filter(e => e.source !== "manual" && !elements(e).some(p => named.has(p)))];
}

// As record_sha in generate.py: SHA-256 of sorted compact JSON.
function RecordSha(record: any)
{
    const canonical = (v: any): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
        : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
        : JSON.stringify(v);
    return createHash("sha256").update(canonical(record)).digest("hex");
}

const Box = (min: number[], max: number[]) => [...min, ...max].map(n => Number(n.toFixed(6)));

// Per element path: class, name, IsExternal and box, read from the IFCX model.
function IfcxElements(v: string)
{
    const data = ReadTimberJunction(`1-model-${v}`).data;
    return Object.fromEntries(ModelElements(v).map(d => {
        const pts: number[][] = data.find(b => b.path === d.children!.Body)!.attributes!["usd::usdgeom::mesh"].points;
        const box = Box([0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), [0, 1, 2].map(i => Math.max(...pts.map(p => p[i]))));
        return [d.path, [d.attributes!["bsi::ifc::class"].code, d.attributes!["bsi::ifc::prop::Name"], d.attributes!["bsi::ifc::prop::IsExternal"], box]];
    }));
}

// The same from the STEP twin, with each GlobalId turned into its IFCX path.
function StepElements(v: string)
{
    const step = fs.readFileSync(`${timberJunctionPath}/ifc-lite/model-${v}.ifc`).toString();
    const rows = new Map([...step.matchAll(/^(#\d+)=(\w+)\((.*)\);$/gm)].map(m => [m[1], { type: m[2], args: m[3] }]));
    const refs = (id: string) => rows.get(id)!.args.match(/#\d+/g)!;
    const nums = (id: string) => (rows.get(id)!.args.match(/-?\d+\.\d*/g) ?? []).map(Number);
    const external = new Map<string, boolean>();
    for (const r of rows.values()) {
        if (r.type !== "IFCRELDEFINESBYPROPERTIES") continue;
        const [, product, pset] = r.args.match(/#\d+/g)!;
        external.set(product, rows.get(refs(pset)[1])!.args.includes("IFCBOOLEAN(.T.)"));
    }
    const out: { [path: string]: any[] } = {};
    for (const [id, r] of rows) {
        const cls = { IFCWALL: "IfcWall", IFCSLAB: "IfcSlab" }[r.type];
        if (!cls) continue;
        const [, gid, rawName, lp, pds] = r.args.match(/^'([^']+)',#\d+,'([^']*)',\$,\$,(#\d+),(#\d+)/)!;
        const name = rawName.replace(/\\X2\\([0-9A-F]{4})\\X0\\/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const origin = nums(refs(refs(lp)[1])[0]);
        const solid = refs(refs(pds)[0])[1];
        const profile = refs(solid)[0];
        const [dx, dy] = nums(profile), [dz] = nums(solid);
        // The profile is centred on its own half extents, so the solid spans origin to origin + size.
        expect(nums(refs(refs(profile)[0])[0]), `${gid} profile centre`).to.deep.equal([dx / 2, dy / 2].map(n => Number(n.toFixed(3))));
        out[PathOf(gid)] = [cls, name, external.get(id), Box(origin, [origin[0] + dx, origin[1] + dy, origin[2] + dz])];
    }
    return out;
}

// "<code>/<version> <state> <carried relation> <carried-from path prefixes>", with "-" in place of a missing type.
function Summary(o: PostCompositionNode)
{
    const type = o.attributes.get("dokwood::detail::type");
    const assignment = o.attributes.get("dokwood::detail::assignment");
    const carried = assignment?.carriedFrom;
    return [type ? `${type.code}/${type.version}` : "-", assignment?.state, carried?.relation,
            carried?.occurrences.map((p: string) => p.slice(0, 8)).join("+")]
        .filter(x => x).join(" ");
}

function OccurrenceNodes(root: PostCompositionNode)
{
    const group = [...root.children.values()].find(n => n.attributes.get("bsi::ifc::prop::Name") === occurrenceGroupName);
    if (!group) throw new Error(`No root node named "${occurrenceGroupName}" in the composed timber junction stack`);
    return group.children;
}

function OccurrenceSummaries(root: PostCompositionNode)
{
    return Object.fromEntries([...OccurrenceNodes(root)].map(([name, o]) => [name, Summary(o)]));
}
