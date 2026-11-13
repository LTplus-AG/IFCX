import { SchemasToOpenAPI } from "../ifcx-core/schema/schema-export";
import { SchemaValidationError } from "../ifcx-core/schema/schema-validation";
import { LoadIfcxFile } from "../ifcx-core/workflows";
import { ExampleFile, ExampleFileMissingSchema, ExampleFileWithSchema } from "./example-file";
import { describe, it } from "./util/cappucino";
import { expect } from "chai";

describe("schemas", () => {
    it("can generate openAPI", () => {
        let openAPISchema = SchemasToOpenAPI(ExampleFile());

        // TODO
        expect(openAPISchema.length).to.equal(926);
    });

    it("throws error if attribute references unknown schema ID", () => {
        expect(() => LoadIfcxFile(ExampleFileMissingSchema())).to.throw(SchemaValidationError);
    });

    it("throws error if attributes fail to validate", () => {
        expect(() => LoadIfcxFile(ExampleFileWithSchema("Boolean", "x"))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFileWithSchema("String", 1))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFileWithSchema("DateTime", 1))).to.throw(SchemaValidationError);
        
        expect(() => LoadIfcxFile(ExampleFileWithSchema("Enum", 1))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::enum", [null]))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::enum", "d"))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::enum", "c"))).to.not.throw(SchemaValidationError);
        
        expect(() => LoadIfcxFile(ExampleFileWithSchema("Integer", "1"))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFileWithSchema("Real", "1"))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFileWithSchema("Reference", 1))).to.throw(SchemaValidationError);

        expect(() => LoadIfcxFile(ExampleFileWithSchema("Object", false))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::object", [null]))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::object", {val1: ""}))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::object", {val1: "", val2: "d"}))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::object", {val1: false, val2: "a"}))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::object", {val1: "", val2: "a"}))).to.not.throw(SchemaValidationError);
        
        expect(() => LoadIfcxFile(ExampleFile("example::optional_object", {val1: "", val2: "a"}))).to.not.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::optional_object", {val1: undefined, val2: "a"}))).to.not.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::optional_object", {val2: "a"}))).to.not.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::optional_object", {val1: null, val2: null}))).to.throw(SchemaValidationError);

        expect(() => LoadIfcxFile(ExampleFileWithSchema("Array", "a"))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::array", [false]))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::array", ["d"]))).to.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::array", []))).to.not.throw(SchemaValidationError);
        expect(() => LoadIfcxFile(ExampleFile("example::array", ["a"]))).to.not.throw(SchemaValidationError);
    });

    it("accepts a later layer nulling an attribute", () => {
        let file = ExampleFile("example::object", {val1: "", val2: "a"});
        file.data.push({path: "root", attributes: {"example::object": null}});
        expect(LoadIfcxFile(file).children.get("root")!.attributes.get("example::object")).to.not.exist;

        file.data.push({path: "root", attributes: {"example::boolean": "x"}});
        expect(() => LoadIfcxFile(file)).to.throw(SchemaValidationError);
    });

    it("rejects null for a nested object value", () => {
        let file = ExampleFile("example::nested", {inner: null});
        file.schemas["example::nested"] = {
            uri: "http://www.example.com/nested",
            value: {
                dataType: "Object",
                objectRestrictions: {values: {inner: {dataType: "Object", objectRestrictions: {values: {x: {dataType: "String"}}}}}}
            }
        };
        expect(() => LoadIfcxFile(file)).to.throw(SchemaValidationError);
    });
});