import "@typespec/json-schema";

using JsonSchema;

/**
 * Tiered geometry system for IFCX.
 *
 * Geometry is separated into three independent tiers stored as separate attribute tables.
 * Consumers load only the tiers they need — a viewer loads only Tier A,
 * a structural analysis tool loads only Tier B, etc.
 */

/** Tier A: Display Mesh — triangulated mesh for rendering. Required tier. */
@jsonSchema
model DisplayMesh {
    /** Vertex positions as array of [x, y, z] triples */
    points: float64[][];

    /** Triangle vertex indices into the points array */
    faceVertexIndices: uint32[];

    /** Optional vertex normals as array of [nx, ny, nz] triples */
    normals?: float64[][];

    /** Optional UV coordinates as array of [u, v] pairs */
    uvs?: float64[][];

    /** Level of detail tag */
    lod?: "lod1" | "lod2" | "lod3";
}

/** Tier B: Precise BRep — boundary representation for analysis and fabrication. Optional. */
@jsonSchema
model BRepGeometry {
    /** BRep format identifier */
    format: BRepFormat;

    /** The BRep payload, either as text or base64-encoded binary */
    data: string;

    /** Encoding of the data field */
    encoding?: "text" | "base64";

    /** Geometric tolerance */
    tolerance?: float64;

    /** Unit system identifier */
    units?: string;
}

enum BRepFormat {
    OCCT_BREP: "OCCT_BREP",
    STEP_AP242: "STEP_AP242",
}

/** Tier C: Procedural Hint — lightweight description of the operation that produced a shape. Optional, informational only. */
@jsonSchema
model ProceduralHint {
    /** The geometric operation type (e.g. "extrude", "revolve", "sweep", "boolean") */
    operation: string;

    /** Operation-specific parameters */
    parameters: Record<unknown>;
}
