// Minimal STEP Part 21 (ISO 10303-21) parser.
//
// STEP21 is a line-based ASCII format used by IFC (IFC2x3 / IFC4 / IFC4X3),
// STEP AP242 mechanical CAD, and other ISO 10303 application protocols.
//
// Grammar (relevant subset):
//   #<id> = <ENTITY_NAME>(<arg>, <arg>, ...);
//   args: $ | * | INTEGER | REAL | 'string' | .ENUM. | #<ref> | (<list>) | NESTED(...)
//
// We only support the subset actually used by IFC / AP242 in DATA sections.
// Comments (/* ... */), forward references (handled), nested constructors
// (e.g. IFCREAL(1.0)), and lists work.

export type StepValue =
    | { kind: "ref"; id: number }
    | { kind: "int"; value: number }
    | { kind: "real"; value: number }
    | { kind: "string"; value: string }
    | { kind: "enum"; value: string }
    | { kind: "null" }
    | { kind: "derived" }
    | { kind: "list"; items: StepValue[] }
    | { kind: "constructor"; type: string; args: StepValue[] };

export interface StepEntity {
    id: number;
    type: string;
    args: StepValue[];
}

export interface StepFile {
    schema: string;
    entities: Map<number, StepEntity>;
}

// -- Lexer -------------------------------------------------------------------

class Lexer {
    private src: string;
    private pos: number;

    constructor(src: string) {
        this.src = src;
        this.pos = 0;
    }

    peek(): string {
        return this.pos < this.src.length ? this.src[this.pos] : "";
    }

    consume(): string {
        return this.pos < this.src.length ? this.src[this.pos++] : "";
    }

    skipWhitespace(): void {
        while (this.pos < this.src.length) {
            const c = this.src[this.pos];
            if (c === " " || c === "\t" || c === "\n" || c === "\r") {
                this.pos++;
            } else if (c === "/" && this.src[this.pos + 1] === "*") {
                // Block comment
                this.pos += 2;
                while (this.pos < this.src.length && !(this.src[this.pos] === "*" && this.src[this.pos + 1] === "/")) {
                    this.pos++;
                }
                this.pos += 2;
            } else {
                return;
            }
        }
    }

    atEnd(): boolean {
        this.skipWhitespace();
        return this.pos >= this.src.length;
    }

    /** Read characters until the next unquoted occurrence of `terminators` chars. */
    readUntil(terminators: string): string {
        const start = this.pos;
        while (this.pos < this.src.length && !terminators.includes(this.src[this.pos])) {
            this.pos++;
        }
        return this.src.slice(start, this.pos);
    }
}

// -- Argument parser ---------------------------------------------------------

function parseArgs(lex: Lexer): StepValue[] {
    const args: StepValue[] = [];
    // Caller already consumed '('
    while (true) {
        lex.skipWhitespace();
        const c = lex.peek();
        if (c === ")") {
            lex.consume();
            return args;
        }
        if (args.length > 0) {
            if (c !== ",") {
                // Include a snippet of context to aid debugging
                const p = (lex as any).pos as number;
                const ctx = (lex as any).src.slice(Math.max(0, p - 20), p + 20);
                throw new Error(`STEP parse: expected ',' or ')' at pos ${p}, got '${c}' (near "${ctx}")`);
            }
            lex.consume(); // ','
            lex.skipWhitespace();
        }
        args.push(parseValue(lex));
    }
}

function parseValue(lex: Lexer): StepValue {
    lex.skipWhitespace();
    const c = lex.peek();

    if (c === "$") { lex.consume(); return { kind: "null" }; }
    if (c === "*") { lex.consume(); return { kind: "derived" }; }

    if (c === "#") {
        lex.consume();
        const id = parseInt(lex.readUntil(",)( "), 10);
        return { kind: "ref", id };
    }

    if (c === "'") {
        lex.consume();
        // STEP21 strings: delimited by ', escape '' → '. Backslashes are LITERAL
        // (the \X\, \X2\…\X0\, \S\… encodings are decoded out-of-band, not by the
        // parser). Loop until we find a single ' that isn't followed by another '.
        let s = "";
        while (true) {
            const ch = lex.peek();
            if (ch === "") break;
            if (ch === "'") {
                if (lex.src[(lex as any).pos + 1] === "'") {
                    lex.consume(); lex.consume();
                    s += "'";
                } else {
                    break;
                }
            } else {
                s += lex.consume();
            }
        }
        lex.consume(); // closing '
        return { kind: "string", value: s };
    }

    if (c === ".") {
        lex.consume();
        let s = "";
        while (lex.peek() !== "." && lex.peek() !== "") s += lex.consume();
        lex.consume(); // closing .
        return { kind: "enum", value: s };
    }

    if (c === "(") {
        lex.consume();
        const items = parseArgs(lex);
        return { kind: "list", items };
    }

    if ((c >= "0" && c <= "9") || c === "-" || c === "+") {
        // Number — integer or real
        const tok = lex.readUntil(",)( ");
        if (/[.eE]/.test(tok)) {
            return { kind: "real", value: parseFloat(tok) };
        }
        return { kind: "int", value: parseInt(tok, 10) };
    }

    // Constructor: ENTITY_NAME(args)
    if ((c >= "A" && c <= "Z") || c === "_") {
        const type = lex.readUntil("( ");
        lex.skipWhitespace();
        if (lex.peek() !== "(") {
            throw new Error(`STEP parse: expected '(' after constructor type '${type}'`);
        }
        lex.consume();
        const args = parseArgs(lex);
        return { kind: "constructor", type, args };
    }

    throw new Error(`STEP parse: unexpected character '${c}' at pos ${(lex as any).pos}`);
}

// -- File parser -------------------------------------------------------------

/** Parse an entire STEP21 file. */
export function parseStep21(text: string): StepFile {
    const entities = new Map<number, StepEntity>();
    let schema = "";

    // Coarse: split into HEADER and DATA sections via section markers.
    // Then within DATA, parse line-by-line.
    const headerStart = text.indexOf("HEADER;");
    const dataStart = text.indexOf("DATA;");
    const endsec = "ENDSEC;";

    if (headerStart >= 0) {
        const headerEnd = text.indexOf(endsec, headerStart);
        const headerBlock = text.slice(headerStart, headerEnd);
        const schemaMatch = headerBlock.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/);
        if (schemaMatch) schema = schemaMatch[1];
    }

    if (dataStart < 0) {
        throw new Error("STEP parse: no DATA section");
    }
    const dataEnd = text.indexOf(endsec, dataStart);
    const dataBlock = text.slice(dataStart + "DATA;".length, dataEnd);

    // Walk dataBlock entity-by-entity.
    let pos = 0;
    while (pos < dataBlock.length) {
        // Skip whitespace + comments
        while (pos < dataBlock.length) {
            const c = dataBlock[pos];
            if (c === " " || c === "\t" || c === "\n" || c === "\r") {
                pos++;
            } else if (c === "/" && dataBlock[pos + 1] === "*") {
                pos += 2;
                while (pos < dataBlock.length && !(dataBlock[pos] === "*" && dataBlock[pos + 1] === "/")) pos++;
                pos += 2;
            } else {
                break;
            }
        }
        if (pos >= dataBlock.length) break;

        if (dataBlock[pos] !== "#") {
            // Could be incidental text; advance to next semicolon.
            while (pos < dataBlock.length && dataBlock[pos] !== ";") pos++;
            pos++;
            continue;
        }
        pos++; // consume '#'

        // Parse id
        let idEnd = pos;
        while (idEnd < dataBlock.length && /\d/.test(dataBlock[idEnd])) idEnd++;
        const id = parseInt(dataBlock.slice(pos, idEnd), 10);
        pos = idEnd;

        // Skip '=' and whitespace
        while (pos < dataBlock.length && (dataBlock[pos] === " " || dataBlock[pos] === "=")) pos++;

        // Read entity name
        let typeEnd = pos;
        while (typeEnd < dataBlock.length && dataBlock[typeEnd] !== "(") typeEnd++;
        const type = dataBlock.slice(pos, typeEnd).trim();
        pos = typeEnd;

        if (dataBlock[pos] !== "(") {
            // Malformed; skip to next semicolon.
            while (pos < dataBlock.length && dataBlock[pos] !== ";") pos++;
            pos++;
            continue;
        }
        pos++; // consume '('

        // Find matching ')' (track parentheses, handle strings/comments)
        const argsStart = pos;
        let depth = 1;
        let inString = false;
        while (pos < dataBlock.length && depth > 0) {
            const c = dataBlock[pos];
            if (inString) {
                if (c === "'") {
                    if (dataBlock[pos + 1] === "'") {
                        pos += 2;
                        continue;
                    }
                    inString = false;
                }
                pos++;
            } else {
                if (c === "'") inString = true;
                else if (c === "(") depth++;
                else if (c === ")") depth--;
                pos++;
            }
        }
        const argsText = dataBlock.slice(argsStart, pos - 1);
        // Skip past terminating ';'
        while (pos < dataBlock.length && dataBlock[pos] !== ";") pos++;
        pos++; // consume ';'

        // Parse args by feeding into the inner-value parser. Wrap in '(...)' to
        // reuse parseArgs.
        const lex = new Lexer(argsText);
        const args: StepValue[] = [];
        while (!lex.atEnd()) {
            args.push(parseValue(lex));
            lex.skipWhitespace();
            if (lex.peek() === ",") {
                lex.consume();
                lex.skipWhitespace();
            }
        }

        entities.set(id, { id, type, args });
    }

    return { schema, entities };
}

// -- Convenience helpers -----------------------------------------------------

/** Resolve a reference value to its target entity. Returns null if not a ref. */
export function resolveRef(file: StepFile, value: StepValue): StepEntity | null {
    if (value.kind !== "ref") return null;
    return file.entities.get(value.id) ?? null;
}

/** Extract a number from an int / real value (or unwrap a constructor like IFCREAL). */
export function numberOf(value: StepValue): number {
    if (value.kind === "int" || value.kind === "real") return value.value;
    if (value.kind === "constructor" && value.args.length === 1) return numberOf(value.args[0]);
    return NaN;
}

/** Find the first `list` argument in an entity (handles IFC's no-name-prefix vs STEP AP242's name-then-list ordering). */
function firstListArg(ent: StepEntity): StepValue | null {
    for (const a of ent.args) {
        if (a.kind === "list") return a;
    }
    return null;
}

/** Extract a 3D point from a referenced IfcCartesianPoint / cartesian_point. */
export function pointOf(file: StepFile, value: StepValue): [number, number, number] | null {
    const ent = resolveRef(file, value);
    if (!ent) return null;
    const t = ent.type.toUpperCase();
    if (t !== "IFCCARTESIANPOINT" && t !== "CARTESIAN_POINT") return null;
    const coords = firstListArg(ent);
    if (!coords || coords.kind !== "list") return null;
    const xs = coords.items.map(numberOf);
    return [xs[0] ?? 0, xs[1] ?? 0, xs[2] ?? 0];
}

/** Extract a 3D direction from a referenced IfcDirection / direction. */
export function directionOf(file: StepFile, value: StepValue): [number, number, number] | null {
    const ent = resolveRef(file, value);
    if (!ent) return null;
    const t = ent.type.toUpperCase();
    if (t !== "IFCDIRECTION" && t !== "DIRECTION") return null;
    const coords = firstListArg(ent);
    if (!coords || coords.kind !== "list") return null;
    const xs = coords.items.map(numberOf);
    return [xs[0] ?? 0, xs[1] ?? 0, xs[2] ?? 0];
}

/** Get the string value of an IFC GUID attribute. */
export function stringOf(value: StepValue): string | null {
    if (value.kind === "string") return value.value;
    return null;
}
