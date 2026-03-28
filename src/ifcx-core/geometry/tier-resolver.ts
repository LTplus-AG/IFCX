// Tier-aware resolver that loads only requested geometry tiers from attribute tables.
// This enforces the core constraint: a viewer never touches BRep data.

import { AttributeTable } from "./attribute-table";
import { DisplayMesh, BRepGeometry, ProceduralHint, GeometryTier, TIER_TABLE_NAMES } from "./geometry-tiers";

export interface AttributeTableProvider {
    getTable(filename: string): AttributeTable | null;
    hasTable(filename: string): boolean;
}

export class TierResolver {
    private provider: AttributeTableProvider;
    private allowedTiers: Set<GeometryTier>;
    private _accessLog: Set<string> = new Set();

    constructor(provider: AttributeTableProvider, requestedTiers: GeometryTier[]) {
        this.provider = provider;
        this.allowedTiers = new Set(requestedTiers);
    }

    get accessLog(): ReadonlySet<string> {
        return this._accessLog;
    }

    private getTableForTier(tier: GeometryTier): AttributeTable | null {
        if (!this.allowedTiers.has(tier)) {
            return null;
        }
        const tableName = TIER_TABLE_NAMES[tier];
        this._accessLog.add(tableName);
        return this.provider.getTable(tableName);
    }

    resolveDisplayMesh(componentIndex: number): DisplayMesh | null {
        const table = this.getTableForTier("mesh");
        if (!table) return null;
        return table.read<DisplayMesh>(componentIndex);
    }

    resolveBRep(componentIndex: number): BRepGeometry | null {
        const table = this.getTableForTier("brep");
        if (!table) return null;
        return table.read<BRepGeometry>(componentIndex);
    }

    resolveProceduralHint(componentIndex: number): ProceduralHint | null {
        const table = this.getTableForTier("proc");
        if (!table) return null;
        return table.read<ProceduralHint>(componentIndex);
    }

    resolveByRef(typeID: string, componentIndex: number): unknown | null {
        // Find which tier this typeID belongs to
        for (const [tier, tableName] of Object.entries(TIER_TABLE_NAMES)) {
            if (typeID === tableName) {
                if (!this.allowedTiers.has(tier as GeometryTier)) {
                    return null;
                }
                this._accessLog.add(tableName);
                const table = this.provider.getTable(tableName);
                if (!table) return null;
                return table.read(componentIndex);
            }
        }
        // Not a geometry tier — try loading as generic table
        this._accessLog.add(typeID);
        const table = this.provider.getTable(typeID);
        if (!table) return null;
        return table.read(componentIndex);
    }
}

export class InMemoryTableProvider implements AttributeTableProvider {
    private tables: Map<string, AttributeTable> = new Map();

    addTable(table: AttributeTable): this {
        this.tables.set(table.filename, table);
        return this;
    }

    addFromEntries(filename: string, entries: unknown[]): this {
        this.tables.set(filename, AttributeTable.fromEntries(filename, entries));
        return this;
    }

    getTable(filename: string): AttributeTable | null {
        return this.tables.get(filename) ?? null;
    }

    hasTable(filename: string): boolean {
        return this.tables.has(filename);
    }
}
