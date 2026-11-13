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
        const v1 = await ComposeTimberJunction(["1-model-v1", "2-catalog", "3-derivation-v1", "4-assignment-v1"]);
        const v2 = await ComposeTimberJunction(["1-model-v2", "2-catalog", "3-derivation-v2", "4-assignment-v1", "4-lineage-v1-v2", "4-assignment-v2"]);

        const v1Types = Occurrences(v1).map(o => o.attributes.get("dokwood::detail::type")?.code ?? null);
        expect(v1Types).to.deep.equal(["D012", "D012", "D021", null]);

        const v2Occurrences = Occurrences(v2);
        expect(v2Occurrences.map(o => o.attributes.get("dokwood::detail::assignment")?.state ?? null))
            .to.deep.equal(["to-confirm", "to-confirm", "in-review", "approved", null]);

        // Known gap: v1 assignments whose occurrence was not re-derived compose as member-less roots.
        const orphans = [...v2.children.values()].filter(n =>
            n.attributes.has("dokwood::detail::assignment") && !n.attributes.has("dokwood::detail::members"));
        expect(orphans.length).to.equal(2);
    });
    it("timber junction v2 stack composes the same in reverse layer order", async () => {
        // No two layers write the same attribute on the same path, so order cannot decide anything here.
        const names = ["1-model-v2", "2-catalog", "3-derivation-v2", "4-assignment-v1", "4-lineage-v1-v2", "4-assignment-v2"];
        const summary = (root: PostCompositionNode) => Occurrences(root).map(o => [
            o.attributes.get("dokwood::detail::type")?.code ?? null,
            o.attributes.get("dokwood::detail::assignment")?.state ?? null]);
        const forward = await ComposeTimberJunction(names);
        const reverse = await ComposeTimberJunction([...names].reverse());
        expect(summary(reverse)).to.deep.equal(summary(forward));
    });
    it("timber junction lineage is bound to the model file hashes", () => {
        const lineageFile = ReadTimberJunction("4-lineage-v1-v2");
        const lineage = lineageFile.data[0].attributes!["dokwood::lineage"];
        const sha = (name: string) => createHash("sha256").update(fs.readFileSync(`${timberJunctionPath}/${name}.ifcx`)).digest("hex");
        expect(lineage.base.sha256).to.equal(sha("1-model-v1"));
        expect(lineage.head.sha256).to.equal(sha("1-model-v2"));
    });
});

const timberJunctionPath = `${examplesFolderPath}/Timber Junction`;

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
        new FetchLayerProvider()
    ]);
    const layerStack = await (new IfcxLayerStackBuilder(provider).FromId(order.header.id)).Build();
    if (layerStack instanceof Error) throw layerStack;
    return LoadIfcxFile(layerStack.GetFederatedLayer());
}

function Occurrences(root: PostCompositionNode)
{
    const group = [...root.children.values()].find(n => n.attributes.get("bsi::ifc::prop::Name") === "Detail occurrences (derived)");
    if (!group) throw new Error(`No root node named "Detail occurrences (derived)" in the composed timber junction stack`);
    return [...group.children.values()];
}
