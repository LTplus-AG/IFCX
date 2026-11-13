import * as fs from "fs";
import { createHash } from "crypto";

import { describe, it } from "./util/cappucino";
import { expect } from "chai";
import { LoadIfcxFile } from "../ifcx-core/workflows";
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
            Wand_3__Decke: "D021/v1 approved", Wand_4__Decke: "-" });
        expect(OccurrenceSummaries(v2)).to.deep.equal({
            Wand_1_1__Decke: "D012/v3 to-confirm split c876b170", Wand_1_2__Decke: "D012/v3 to-confirm split c876b170",
            Wand_2__Decke: "D012/v3 in-review renamed d5a65e9f", Wand_3__Decke: "D021/v1 approved", Wand_4__Decke: "-" });

        // Known gap: v1 assignments whose occurrence was not re-derived compose as member-less roots.
        const orphans = [...v2.children.values()].filter(n =>
            n.attributes.has("dokwood::detail::assignment") && !n.attributes.has("dokwood::detail::members"));
        const derivedV2 = new Set(ReadTimberJunction("3-derivation-v2").data.map(d => d.path));
        const notRederived = ReadTimberJunction("4-assignment-v1").data.map(d => d.path).filter(p => !derivedV2.has(p));
        expect(orphans.map(n => n.node).sort()).to.deep.equal(notRederived.sort());
        expect(orphans.map(Summary).sort()).to.deep.equal(["D012/v3 approved", "D012/v3 in-review"]);
        const carriedFrom = ReadTimberJunction("4-assignment-v2").data.map(d => d.attributes!["dokwood::detail::assignment"].carriedFrom.occurrence);
        expect([...new Set(carriedFrom)].sort()).to.deep.equal(notRederived.sort());
    });
    it("timber junction v2 stack composes the same in reverse layer order", async () => {
        // No two layers write the same attribute on the same path, so order cannot decide anything here.
        const forward = await ComposeTimberJunction(timberJunctionV2);
        const reverse = await ComposeTimberJunction([...timberJunctionV2].reverse());
        expect(NodeToJSON(reverse)).to.deep.equal(NodeToJSON(forward));
    });
    it("timber junction lineage and derivations are bound to the model files", () => {
        const binding = (v: string) => {
            const bytes = fs.readFileSync(TimberJunctionFile(`1-model-${v}`));
            return { layer: (JSON.parse(bytes.toString()) as IfcxFile).header.id,
                     sha256: createHash("sha256").update(bytes).digest("hex") };
        };
        const lineage = ReadTimberJunction("4-lineage-v1-v2").data.find(d => d.attributes?.["dokwood::lineage"])!.attributes!["dokwood::lineage"];
        expect(lineage.base).to.deep.equal(binding("v1"));
        expect(lineage.head).to.deep.equal(binding("v2"));
        for (const v of ["v1", "v2"]) {
            const data = ReadTimberJunction(`3-derivation-${v}`).data;
            const group = data.find(d => d.children);
            expect(group, `occurrence group in 3-derivation-${v}`).to.exist;
            const occurrences = data.filter(d => d !== group);
            expect(occurrences.map(d => d.path).sort()).to.deep.equal(Object.values(group!.children!).sort());
            const expected = binding(v);
            for (const d of occurrences) {
                const derivation = d.attributes!["dokwood::derivation"];
                expect({ layer: derivation.sourceLayer, sha256: derivation.sourceSha256 }).to.deep.equal(expected);
            }
        }
    });
});

const timberJunctionPath = `${examplesFolderPath}/Timber Junction`;
const timberJunctionV1 = ["1-model-v1", "2-catalog", "3-derivation-v1", "4-assignment-v1"];
const timberJunctionV2 = ["1-model-v2", "2-catalog", "3-derivation-v2", "4-assignment-v1", "4-lineage-v1-v2", "4-assignment-v2"];
// One provider for all composes, so the ifcx.dev imports are fetched once per run.
const fetchProvider = new FetchLayerProvider();

function TimberJunctionFile(name: string)
{
    return `${timberJunctionPath}/${name}.ifcx`;
}

function ReadTimberJunction(name: string)
{
    return JSON.parse(fs.readFileSync(TimberJunctionFile(name)).toString()) as IfcxFile;
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
    return LoadIfcxFile(layerStack.GetFederatedLayer());
}

// "<code>/<version> <state> <carried relation> <carried-from path prefix>", with "-" in place of a missing type.
function Summary(o: PostCompositionNode)
{
    const type = o.attributes.get("dokwood::detail::type");
    const assignment = o.attributes.get("dokwood::detail::assignment");
    const carried = assignment?.carriedFrom;
    return [type ? `${type.code}/${type.version}` : "-", assignment?.state, carried?.relation, carried?.occurrence.slice(0, 8)]
        .filter(x => x).join(" ");
}

function OccurrenceSummaries(root: PostCompositionNode)
{
    const group = [...root.children.values()].find(n => n.attributes.get("bsi::ifc::prop::Name") === "Detail occurrences (derived)");
    if (!group) throw new Error(`No root node named "Detail occurrences (derived)" in the composed timber junction stack`);
    return Object.fromEntries([...group.children].map(([name, o]) => [name, Summary(o)]));
}
