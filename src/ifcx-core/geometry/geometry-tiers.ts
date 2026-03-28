// Tiered geometry types for IFCX
// Each tier is an independent attribute table — consumers load only what they need

export interface DisplayMesh {
    points: number[][];
    faceVertexIndices: number[];
    normals?: number[][];
    uvs?: number[][];
    lod?: "lod1" | "lod2" | "lod3";
}

export interface BRepGeometry {
    format: "OCCT_BREP" | "STEP_AP242";
    data: string;
    encoding?: "text" | "base64";
    tolerance?: number;
    units?: string;
}

export interface ProceduralHint {
    operation: string;
    parameters: Record<string, unknown>;
}

export type GeometryTier = "mesh" | "brep" | "proc";

export const TIER_TABLE_NAMES: Record<GeometryTier, string> = {
    mesh: "ifcx.geom.mesh",
    brep: "ifcx.geom.brep",
    proc: "ifcx.geom.proc",
};
