// Canonical serialization + SHA-256 hash for Tier P / Tier B source records.
// Used to populate DisplayMesh.sourceHash so consumers can detect when a
// cached mesh is stale relative to its source.
//
// Canonicalization follows RFC 8785 (JCS) principles:
//   - object keys sorted lexicographically
//   - no whitespace
//   - numbers serialized via shortest round-trip (Number.prototype.toString
//     in JS produces shortest unique representations for finite doubles, so
//     JSON.stringify of canonical objects is already RFC-8785-compatible for
//     our purposes).
//
// Hash: SHA-256 via Node's `crypto` module. Returns "sha256-<hex>" prefix so
// the value works as a Subresource-Integrity-style identifier.

import { createHash } from "crypto";

/** Canonical JSON serialization: sorted keys, no whitespace, deterministic numbers. */
export function canonicalize(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return "null"; // RFC 8785 maps non-finites to null
        return value.toString();
    }
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(v => canonicalize(v)).join(",") + "]";
    }
    if (typeof value === "object") {
        const keys = Object.keys(value as object).sort();
        const parts: string[] = [];
        for (const k of keys) {
            const v = (value as Record<string, unknown>)[k];
            if (v === undefined) continue;
            parts.push(JSON.stringify(k) + ":" + canonicalize(v));
        }
        return "{" + parts.join(",") + "}";
    }
    return "null";
}

/** SHA-256 hash of any value's canonical form. Returns "sha256-<hex>". */
export function sourceHashOf(value: unknown): string {
    const canon = canonicalize(value);
    const h = createHash("sha256").update(canon, "utf8").digest("hex");
    return `sha256-${h}`;
}
