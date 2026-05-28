// Canonical serialization + SHA-256 hash for Tier P / Tier B source records.
// Used to populate DisplayMesh.sourceHash so consumers can detect when a
// cached mesh is stale relative to its source.
//
// Canonicalization follows RFC 8785 (JCS) principles:
//   - object keys sorted lexicographically
//   - no whitespace
//   - numbers serialized via shortest round-trip (Number.prototype.toString
//     in JS produces shortest unique representations for finite doubles).
//
// SHA-256 is a pure-TS implementation (no Node/Browser environment split),
// so the module works identically server-side and client-side. Returns
// "sha256-<hex>" prefix matching Subresource-Integrity convention.

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
    return `sha256-${sha256Hex(canon)}`;
}

// -- Pure-TS SHA-256 ---------------------------------------------------------
//
// Standard FIPS 180-4 implementation. Used in browser-bundled paths where
// node:crypto isn't available. Operates on UTF-8 bytes; returns 64 lowercase
// hex chars.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function utf8Encode(s: string): Uint8Array {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    // Fallback (older runtimes): manual UTF-8 encode
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c < 0x80) bytes.push(c);
        else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        else if ((c & 0xfc00) === 0xd800 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            c = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(++i) & 0x3ff));
            bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return new Uint8Array(bytes);
}

export function sha256Hex(text: string): string {
    const bytes = utf8Encode(text);
    const bitLen = bytes.length * 8;

    // Padding: append 1 bit, then zeros, then 64-bit big-endian length
    const paddedLen = ((bytes.length + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLen);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    // 64-bit length, big-endian, last 8 bytes
    const hiLen = Math.floor(bitLen / 0x100000000);
    const loLen = bitLen >>> 0;
    padded[paddedLen - 8] = (hiLen >>> 24) & 0xff;
    padded[paddedLen - 7] = (hiLen >>> 16) & 0xff;
    padded[paddedLen - 6] = (hiLen >>> 8) & 0xff;
    padded[paddedLen - 5] = hiLen & 0xff;
    padded[paddedLen - 4] = (loLen >>> 24) & 0xff;
    padded[paddedLen - 3] = (loLen >>> 16) & 0xff;
    padded[paddedLen - 2] = (loLen >>> 8) & 0xff;
    padded[paddedLen - 1] = loLen & 0xff;

    const H = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const W = new Uint32Array(64);

    for (let i = 0; i < paddedLen; i += 64) {
        for (let t = 0; t < 16; t++) {
            W[t] = (padded[i + t * 4] << 24) | (padded[i + t * 4 + 1] << 16) | (padded[i + t * 4 + 2] << 8) | padded[i + t * 4 + 3];
            W[t] >>>= 0;
        }
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
            const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
            W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3];
        let e = H[4], f = H[5], g = H[6], h = H[7];
        for (let t = 0; t < 64; t++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        H[0] = (H[0] + a) >>> 0;
        H[1] = (H[1] + b) >>> 0;
        H[2] = (H[2] + c) >>> 0;
        H[3] = (H[3] + d) >>> 0;
        H[4] = (H[4] + e) >>> 0;
        H[5] = (H[5] + f) >>> 0;
        H[6] = (H[6] + g) >>> 0;
        H[7] = (H[7] + h) >>> 0;
    }

    let out = "";
    for (let i = 0; i < 8; i++) {
        out += H[i].toString(16).padStart(8, "0");
    }
    return out;
}
