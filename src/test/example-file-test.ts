import * as fs from "fs";
import { createHash } from "crypto";

import { describe, it } from "./util/cappucino";
import { expect } from "chai";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";
import { InMemoryLayerProvider, StackedLayerProvider } from "../ifcx-core/layers/layer-providers";
import { FetchLayerProvider } from "../ifcx-core/layers/fetch-layer-provider";
import { IfcxLayerStackBuilder } from "../ifcx-core/layers/layer-stack";
import { PostCompositionNode } from "../ifcx-core/composition/node";
import { NodeToJSON } from "./util/node2json";

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
        // Each carried row names the v1 to v2 lineage node and the policy for its relation.
        for (const d of ReadTimberJunction("4-assignment-v2").data) {
            const carried = d.attributes!["dokwood::detail::assignment"].carriedFrom;
            if (!carried) continue;
            expect([carried.lineage, carried.policy], d.path).to.deep.equal([LineageNode("4-lineage-v1-v2").path,
                carried.relation === "merge" ? "same-type-or-none" : "copy-to-all"]);
        }
    });
    it("timber junction approvals hold only for the derivation they reviewed", async () => {
        // The rule, which IFCX does not enforce: approved needs reviewedSha256 equal to the hash of the
        // occurrence's derivation record, and a different reviewedSha256 needs to-confirm.
        const check = async (stack: string[]) => {
            const approved: string[] = [], stale: string[] = [];
            for (const [name, o] of OccurrenceNodes(await ComposeTimberJunction(stack))) {
                const a = o.attributes.get("dokwood::detail::assignment");
                if (!a) continue;
                expect(o.attributes.has("dokwood::derivation"), `${name} derivation`).to.be.true;
                // Only an approval sets a reviewed hash; to-confirm may keep it.
                if (["proposed", "in-review"].includes(a.state)) expect(a, name).to.not.have.property("reviewedSha256");
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
        // On one path only, two layers of the v2 stack write the same attribute or inherits entry.
        const writes = timberJunctionV2.flatMap(layer => ReadTimberJunction(layer).data.flatMap(d => [
            ...Object.entries(d.attributes ?? {}).map(([k, v]) => [`${d.path} ${k}`, JSON.stringify(v)]),
            ...Object.entries(d.inherits ?? {}).map(([k, v]) => [`${d.path} inherits ${k}`, JSON.stringify(v)])]));
        const keys = writes.map(w => w[0]);
        const twice = writes.filter((w, i) => keys.indexOf(w[0]) !== i);
        const wand3 = OccurrencePath("v1", "Wand_3__Decke");
        expect(twice.map(w => w[0])).to.deep.equal([`${wand3} dokwood::detail::assignment`, `${wand3} inherits detailType`]);
        // Every other repeated write has the value of the first, so only the assignment can differ by order.
        expect(twice.filter(w => !w[0].endsWith("assignment") && w[1] !== writes[keys.indexOf(w[0])][1])).to.deep.equal([]);
        // The later layer wins: as committed 4-assignment-v2 comes last and says to-confirm.
        const forward = await ComposeTimberJunction(timberJunctionV2);
        const swapped = await ComposeTimberJunction([...timberJunctionV2.filter(n => n !== "4-assignment-v1"), "4-assignment-v1"]);
        const wand3Of = (root: PostCompositionNode) => OccurrenceNodes(root).get("Wand_3__Decke")!;
        expect([wand3Of(forward), wand3Of(swapped)].map(Summary)).to.deep.equal(["D021/v1 to-confirm", "D021/v1 approved"]);
        // With that one attribute put back, the whole composed tree is the same, orphan roots included.
        wand3Of(swapped).attributes.set("dokwood::detail::assignment", wand3Of(forward).attributes.get("dokwood::detail::assignment"));
        expect(NodeToJSON(swapped)).to.deep.equal(NodeToJSON(forward));
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
        const manual = LineageOf("4-lineage-v1-v2-samename-manual");
        expect([manual.base, manual.head]).to.deep.equal([binding("v1"), binding("v2-samename")]);
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
            const types = new Set(before.map(o => o.attributes.has("dokwood::detail::assignment") ? TypeOf(o) : "-"));
            const agreed = types.size === 1 && !types.has("-");
            expect(after.attributes.get("dokwood::detail::assignment")).to.deep.equal(!agreed ? undefined : { state: "to-confirm",
                carriedFrom: { occurrences: before.map(o => o.node), lineage: LineageNode("4-lineage-v1-v2").path,
                               relation: "merge", policy: "same-type-or-none" } });
            expect(TypeOf(after)).to.equal(agreed ? [...types][0] : "-");
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
    it("timber junction federation: the place spans two discipline models bound by the manifest", async () => {
        const fed = ReadTimberJunction("0-federation-bp");
        const models = ["1-model-v2", "1-model-mep"];
        // The manifest binds each model by its bytes, in SRI form.
        expect(fed.imports).to.deep.equal(models.map(n => ({ uri: ReadTimberJunction(n).header.id,
            integrity: `sha256-${createHash("sha256").update(fs.readFileSync(`${timberJunctionPath}/${n}.ifcx`)).digest("base64")}` })));
        const [place] = ReadTimberJunction("3-derivation-federated").data.filter(d => d.attributes?.["dokwood::derivation"]);
        const derivation = place.attributes!["dokwood::derivation"];
        expect([derivation.sourceLayer, derivation.sourceSha256]).to.deep.equal([fed.header.id, FileSha("0-federation-bp.ifcx")]);
        // One member is an element of the architect's model, the other of the MEP model.
        const owners = (ref: string) => models.filter(n => ReadTimberJunction(n).data.some(d => d.path === ref));
        expect(place.attributes!["dokwood::detail::members"].map((m: any) => [m.role, owners(m.ref)]))
            .to.deep.equal([["penetrated", ["1-model-v2"]], ["penetrating", ["1-model-mep"]]]);
        const bp = NodesByPath(await ComposeTimberJunction(timberJunctionBP));
        expect(place.attributes!["dokwood::detail::members"].filter((m: any) => !bp.has(m.ref))).to.deep.equal([]);
        // With the manifest as the only entry, its imports bring in both models. A wrong integrity changes nothing:
        // IFCX does not check it.
        const viaManifest = async (manifest: IfcxFile) => NodeToJSON(await ComposeFiles(
            [manifest, ReadTimberJunction("3-derivation-federated")], models.map(ReadTimberJunction)));
        const bogus = { ...fed, imports: fed.imports.map(i => ({ ...i, integrity: "sha256-AAAA" })) };
        const composed = await viaManifest(fed);
        expect(Object.keys(composed.children)).to.include.members(models.map(n => ReadTimberJunction(n).data[0].path));
        expect(await viaManifest(bogus)).to.deep.equal(composed);
    });
    it("timber junction views: each view types a place on its own node, and swapping view layers changes nothing", async () => {
        // The rule, which IFCX does not check: a view occurrence sits at uuid5(ns, "view|<view>|<place>") and inherits
        // exactly place and type, so a place has at most one type per view. Read from the input files, since the
        // composed output has no inherits.
        const places = new Set(["3-derivation-v2", "3-derivation-federated"].flatMap(n =>
            ReadTimberJunction(n).data.filter(d => d.attributes?.["dokwood::derivation"]).map(d => d.path)));
        const viewLayers = ["5-view-detail-bp", "5-view-cost-bp"];
        for (const layer of [...viewLayers, "5-view-cost-vp"]) {
            const [group, ...occurrences] = ReadTimberJunction(layer).data;
            expect(Object.values(group.children!).sort(), layer).to.deep.equal(occurrences.map(d => d.path).sort());
            for (const d of occurrences) {
                const view = d.attributes!["dokwood::assignment"].view;
                expect(group.path, d.path).to.equal(Uuid5(timberJunctionNs, `view-group|${view}`));
                if (d.attributes!["dokwood::scope"]) {
                    expect([d.path, Object.keys(d.inherits!)]).to.deep.equal([ScopeItem(), ["type"]]);
                    continue;
                }
                expect(Object.keys(d.inherits!), d.path).to.deep.equal(["place", "type"]);
                expect(places.has(d.inherits!.place), d.path).to.be.true;
                expect(d.path).to.equal(Uuid5(timberJunctionNs, `view|${view}|${d.inherits!.place}`));
            }
        }
        // A view layer writes no path that any other layer of the stack writes.
        const writes = (n: string) => ReadTimberJunction(n).data.map(d => d.path);
        for (const layer of viewLayers) {
            const others = new Set(timberJunctionBP.filter(n => n !== layer).flatMap(writes));
            expect(writes(layer).filter(p => others.has(p)), layer).to.deep.equal([]);
        }
        // Two views type the same place differently and each sees the place's members, extent and derivation.
        const bp = await ComposeTimberJunction(timberJunctionBP);
        const [detail, cost] = ["detail", "cost"].map(v => RootNamed(bp, `View: ${v}`).children);
        const placeKeys = ["dokwood::derivation", "dokwood::detail::members", "dokwood::detail::topology"];
        expect([...cost.keys()]).to.deep.equal(["Wand_1_1__Decke", "Wand_1_2__Decke", "Wand_2__Decke"]);
        for (const [name, c] of cost) {
            const d = detail.get(name)!;
            expect([TypeOf(d), d.attributes.get("dokwood::type::generic").code], name).to.deep.equal(["D012/v3", "G-SB-EXT"]);
            expect([TypeOf(c), c.attributes.get("dokwood::type::generic").code], name).to.deep.equal(["-", "G-SB-EXT"]);
            // No view occurrence carries another view's attributes.
            expect([...d.attributes.keys()].sort(), name).to.deep.equal([...placeKeys, "dokwood::assignment",
                "dokwood::detail::type", "dokwood::type::generic"].sort());
            expect([...c.attributes.keys()].sort(), name).to.deep.equal([...placeKeys, "dokwood::assignment",
                "dokwood::cost::line", "dokwood::type::generic"].sort());
            expect(c.attributes.get("dokwood::derivation")).to.deep.equal(d.attributes.get("dokwood::derivation"));
        }
        const swap = timberJunctionBP.map(n => n === viewLayers[0] ? viewLayers[1] : n === viewLayers[1] ? viewLayers[0] : n);
        expect(swap).to.not.deep.equal(timberJunctionBP);
        expect(NodeToJSON(await ComposeTimberJunction(swap))).to.deep.equal(NodeToJSON(bp));
        // Known gap: a view occurrence whose place does not exist composes without error and just lacks the place.
        const generic = ReadTimberJunction("2-catalog-generic").data[1].path;
        const gone = Uuid5(timberJunctionNs, "occurrence|gone");
        const orphan = ScratchLayer("orphan-view-occurrence", [{ path: Uuid5(timberJunctionNs, `view|cost|${gone}`),
            inherits: { place: gone, type: generic } }]);
        const withOrphan = await ComposeFiles([...timberJunctionBP.map(ReadTimberJunction), orphan]);
        expect([...withOrphan.children.get(orphan.data[0].path)!.attributes.keys()]).to.deep.equal(["dokwood::type::generic"]);
    });
    it("timber junction views: a type written on the place leaks into every view, so the place holds no opinions", async () => {
        const bp = timberJunctionBP.map(ReadTimberJunction);
        const place = OccurrencePath("v2", "Wand_1_1__Decke");
        const catalog = ReadTimberJunction("2-catalog").data[0].path;
        const viewsOf = async (files: IfcxFile[]) => {
            const root = await ComposeFiles(files);
            return ["detail", "cost"].map(v => RootNamed(root, `View: ${v}`).children.get("Wand_1_1__Decke")!);
        };
        const [detail, cost] = await viewsOf(bp);
        expect([TypeOf(detail), TypeOf(cost)]).to.deep.equal(["D012/v3", "-"]);
        // Throwaway layer, not committed: the old single-view shape, a detail type on the place itself.
        const opinion = ScratchLayer("detail-type-on-the-place", [{ path: place, inherits: { detailType: `${catalog}/D021/v1` } }]);
        const [detailAfter, costAfter] = await viewsOf([...bp, opinion]);
        // inherits is transitive: the cost occurrence now shows a detail type nobody in the cost view chose. The detail
        // occurrence inherits dokwood::detail::type twice and keeps its own here, without any error.
        expect([TypeOf(detailAfter), TypeOf(costAfter)]).to.deep.equal(["D012/v3", "D021/v1"]);
    });
    it("timber junction type chain: generic, D012/v3 and the fabrication variant compose and validate", async () => {
        const nodes = NodesByPath(await ComposeTimberJunction(timberJunctionBP));
        const [, f2] = ReadTimberJunction("2-catalog-fab").data;
        // Each level writes its own attribute id; the composed variant shows all three, the edges are gone.
        const levels = ["2-catalog-generic", "2-catalog", "2-catalog-fab"].map(n =>
            [...new Set(ReadTimberJunction(n).data.flatMap(d => Object.keys(d.attributes ?? {})))].sort());
        expect(levels).to.deep.equal([["dokwood::type::generic"], ["dokwood::catalog", "dokwood::detail::type"], ["dokwood::fab::variant"]]);
        const variant = nodes.get(f2.path)!;
        expect([...variant.attributes.keys()].sort()).to.deep.equal(["dokwood::detail::type", "dokwood::fab::variant", "dokwood::type::generic"]);
        expect([variant.attributes.get("dokwood::type::generic").code, TypeOf(variant), variant.attributes.get("dokwood::fab::variant").code])
            .to.deep.equal(["G-SB-EXT", "D012/v3", "D012-v3-F2"]);
        // The VP scope item reaches the generic type without the detail catalog.
        const vp = NodesByPath(await ComposeTimberJunction(timberJunctionVP));
        expect(vp.get(ScopeItem())!.attributes.get("dokwood::type::generic").code).to.equal("G-SB-EXT");
        // Every node is validated before inherits is expanded, so a bad value at the top of the chain fails the stack.
        const bad = structuredClone(ReadTimberJunction("2-catalog-generic"));
        bad.data[1].attributes!["dokwood::type::generic"].unit = 1;
        const error = await ComposeFiles(timberJunctionBP.map(n => n === "2-catalog-generic" ? bad : ReadTimberJunction(n)))
            .then(() => null, (e: Error) => e.message);
        expect(error).to.include("dokwood::type::generic");
    });
    it("timber junction phases: the VP scope item is split into the BP cost items by length", async () => {
        const binding = (n: string, phase?: string) => ({ layer: ReadTimberJunction(n).header.id, sha256: FileSha(`${n}.ifcx`),
            ...(phase ? { phase } : {}) });
        const phase = LineageOf("6-lineage-vp-bp");
        expect([phase.axis, phase.base, phase.head]).to.deep.equal(["phase", binding("5-view-cost-vp", "VP"), binding("5-view-cost-bp", "BP")]);
        // Successors: the cost items over every exterior slab-on-wall place derived from model v2, in derivation order.
        const external = new Set(ModelElements("v2").filter(d => d.attributes!["bsi::ifc::prop::IsExternal"] === true).map(d => d.path));
        const places = ReadTimberJunction("3-derivation-v2").data.filter(d => {
            const a = d.attributes!;
            return a["dokwood::detail::topology"]?.junction === "slab-on-wall"
                && external.has(a["dokwood::detail::members"].find((m: any) => m.role === "bearing").ref);
        });
        const costItems = ReadTimberJunction("5-view-cost-bp").data.slice(1).map(d => d.path);
        const [entry] = phase.entries;
        expect([entry.predecessors, entry.relation, entry.source]).to.deep.equal([[ScopeItem()], "split", "manual"]);
        expect(entry.successors).to.deep.equal(places.map(d => Uuid5(timberJunctionNs, `view|cost|${d.path}`)));
        expect([...entry.successors].sort()).to.deep.equal([...costItems].sort());
        const lengths: number[] = places.map(d => d.attributes!["dokwood::detail::topology"].extent.length);
        const total = lengths.reduce((a, b) => a + b, 0);
        expect([lengths, entry.shares]).to.deep.equal([[4, 2, 6], lengths.map(l => l / total)]);
        expect(entry.shares.reduce((a: number, b: number) => a + b, 0)).to.be.closeTo(1, 1e-12);
        // A scope item and its refinements are never in one stack, or the length would count twice.
        expect([timberJunctionVP.includes("5-view-cost-bp"), timberJunctionBP.includes("5-view-cost-vp")]).to.deep.equal([false, false]);
        // Type axis: a catalog revision. v3 replaces v2, it does not refine it.
        const type = LineageOf("6-lineage-type-d012");
        const catalog = ReadTimberJunction("2-catalog").data[0].path;
        expect([type.axis, type.base, type.head]).to.deep.equal(["type", binding("2-catalog"), binding("2-catalog")]);
        expect(type.entries.map((e: any) => [e.predecessors, e.successors, e.relation]))
            .to.deep.equal([[[`${catalog}/D012/v2`], [`${catalog}/D012/v3`], "replaced"]]);
        // The new lineage declaration and the old one, without "axis", validate each other's data in either order.
        await ComposeTimberJunction(["4-lineage-v1-v2", "6-lineage-vp-bp"]);
        await ComposeTimberJunction(["6-lineage-vp-bp", "4-lineage-v1-v2"]);
    });
});

const timberJunctionPath = `${examplesFolderPath}/Timber Junction`;
const timberJunctionV1 = ["1-model-v1", "2-catalog", "3-derivation-v1", "4-assignment-v1", "4-manual-split"];
const timberJunctionV2 = ["1-model-v2", "2-catalog", "3-derivation-v2", "4-assignment-v1", "4-manual-split", "4-lineage-v1-v2", "4-assignment-v2"];
const timberJunctionSameName = ["1-model-v2-samename", "4-lineage-v1-v2-samename", "4-lineage-v1-v2-samename-manual"];
// Views and phases: one stack per phase. VP has a coarse cost scope item, BP the federated models and the places.
const timberJunctionVP = ["2-catalog-generic", "5-view-cost-vp"];
const timberJunctionBP = ["0-federation-bp", "1-model-v2", "1-model-mep", "2-catalog-generic", "2-catalog", "2-catalog-fab",
    "3-derivation-v2", "3-derivation-federated", "5-view-detail-bp", "5-view-cost-bp", "6-lineage-vp-bp", "6-lineage-type-d012"];
// One provider for all composes, so the ifcx.dev imports are fetched once per run.
const fetchProvider = new FetchLayerProvider();

function ReadTimberJunction(name: string)
{
    return JSON.parse(fs.readFileSync(`${timberJunctionPath}/${name}.ifcx`).toString()) as IfcxFile;
}

async function ComposeTimberJunction(names: string[])
{
    return ComposeFiles(names.map(ReadTimberJunction));
}

// Same stacking as `ifcx compose`: later files win. Files in `available` resolve imports but are not stacked themselves.
async function ComposeFiles(files: IfcxFile[], available: IfcxFile[] = [])
{
    const order: IfcxFile = {
        header: { ...files[0].header, id: "timber-junction-stack" },
        imports: files.map(f => ({ uri: f.header.id })),
        schemas: {},
        data: []
    };
    const provider = new StackedLayerProvider([
        new InMemoryLayerProvider().AddAll([order, ...files, ...available]),
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

// Lineage entries name only elements with an occurrence, so not the floor slab.
function ElementPathIn(v: string)
{
    const paths = new Set(ModelElements(v).map(d => d.path).filter(p => p !== slabPath));
    return (gid: string) => {
        expect(paths.has(PathOf(gid)), `${gid} in 1-model-${v}.ifcx, other than the floor slab`).to.be.true;
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
        const value = rows.get(refs(pset)[1])!.args.match(/^'IsExternal',\$,IFCBOOLEAN\(\.([TF])\.\),\$$/);
        expect(value, `IsExternal property of ${product}`).to.exist;
        external.set(product, value![1] === "T");
    }
    const out: { [path: string]: any[] } = {};
    for (const [id, r] of rows) {
        const cls = { IFCWALL: "IfcWall", IFCSLAB: "IfcSlab" }[r.type];
        if (!cls) continue;
        const [, gid, rawName, lp, pds] = r.args.match(/^'([^']+)',#\d+,'((?:[^']|'')*)',\$,\$,(#\d+),(#\d+)/)!;
        const name = rawName.replace(/\\X2\\([0-9A-F]{4})\\X0\\|''|\\\\/g, (m, hex) =>
            hex ? String.fromCharCode(parseInt(hex, 16)) : m[0]);
        const origin = nums(refs(refs(lp)[1])[0]);
        const solid = refs(refs(pds)[0])[1];
        const profile = refs(solid)[0];
        const [dx, dy] = nums(profile), [dz] = nums(solid);
        // The profile is centred on its own half extents, so the solid spans origin to origin + size.
        const centre = nums(refs(refs(profile)[0])[0]);
        [dx, dy].forEach((d, i) => expect(centre[i], `${gid} profile centre`).to.be.closeTo(d / 2, 1e-9));
        out[PathOf(gid)] = [cls, name, external.get(id), Box(origin, [origin[0] + dx, origin[1] + dy, origin[2] + dz])];
    }
    return out;
}

function TypeOf(o: PostCompositionNode)
{
    const type = o.attributes.get("dokwood::detail::type");
    return type ? `${type.code}/${type.version}` : "-";
}

// "<code>/<version> <state> <carried relation> <carried-from path prefixes>", with "-" in place of a missing type.
function Summary(o: PostCompositionNode)
{
    const assignment = o.attributes.get("dokwood::detail::assignment");
    const carried = assignment?.carriedFrom;
    return [TypeOf(o), assignment?.state, carried?.relation,
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

function FileSha(file: string)
{
    return createHash("sha256").update(fs.readFileSync(`${timberJunctionPath}/${file}`)).digest("hex");
}

// Every composed node by its path, wherever it sits in the tree.
function NodesByPath(root: PostCompositionNode, out = new Map<string, PostCompositionNode>())
{
    for (const c of root.children.values()) {
        if (!out.has(c.node)) out.set(c.node, c);
        NodesByPath(c, out);
    }
    return out;
}

function RootNamed(root: PostCompositionNode, name: string)
{
    const node = [...root.children.values()].find(n => n.attributes.get("bsi::ifc::prop::Name") === name);
    if (!node) throw new Error(`No root node named "${name}"`);
    return node;
}

const ScopeItem = () => Uuid5(timberJunctionNs, "view|cost|scope|slab-bearing-exterior");

// An in-memory layer for one test, never written to the example folder.
function ScratchLayer(id: string, data: IfcxFile["data"]): IfcxFile
{
    return { header: { ...ReadTimberJunction("2-catalog").header, id }, imports: [], schemas: {}, data };
}
