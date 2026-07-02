// Viewer-side loader for tiered geometry format.
// Only loads Tier A (display mesh) — never touches BRep or procedural data.

import { ComposedObject } from "./composed-object";
import { IfcxFile } from "../ifcx-core/schema/schema-helper";
import { IndexFileData, loadIndexFile } from "../ifcx-core/geometry/index-file-loader";

export interface TieredFileSet {
    indexFile: IndexFileData;
    ndjsonFiles: Map<string, string>;
}

export function isTieredFormat(data: any): data is IndexFileData {
    return data && data.sections !== undefined && data.attributeTables !== undefined;
}

export function loadTieredAsAlpha(fileSet: TieredFileSet): IfcxFile {
    // Load with only mesh tier — viewer never needs BRep or procedural hints
    const result = loadIndexFile(
        fileSet.indexFile,
        fileSet.ndjsonFiles,
        ["mesh"]
    );
    return result.alphaFile;
}
