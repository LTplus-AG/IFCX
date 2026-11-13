# Timber Junction

A worked example of a **derived object that carries data**: a detail occurrence
(where a timber slab bears on a wall) is derived by a tool, gets a detail type
assigned by a person, and has to keep that assignment when the architect
re-exports the model with new identifiers.

The scenario is the four-wall case from the DOKwood WP9 identity demo. In v2,
Wand 1 is split at 4 m into Wand 1.1 and Wand 1.2, Wand 2 has a new identity
only, Wand 3 is unchanged, and Wand 4 has a new identity and moved 0.50 m.
A slab (Decke über EG) sits on all four walls and is unchanged.

All example attributes use the `dokwood::` namespace. They are not part of IFCX.
See "What would be proposed under bsi::" below.

## Files

| Layer | File | Written by | Contains |
|---|---|---|---|
| 1 model | `1-model-v1.ifcx`, `1-model-v2.ifcx` | authoring tool | Storey, 4 (v2: 5) walls, slab, box meshes |
| 2 catalog | `2-catalog.ifcx` | detail catalog | Detail types D012 (v2, v3) and D021 (v1) with roles |
| 3 derivation | `3-derivation-v1.ifcx`, `3-derivation-v2.ifcx` | detail finder | One occurrence node per wall/slab junction |
| 4 assignment | `4-assignment-v1.ifcx` | detail editor | Type assignment and review state per occurrence |
| 4 provenance | `4-lineage-v1-v2.ifcx` | model comparison | Lineage from v1 walls to v2 walls |
| 4 assignment | `4-assignment-v2.ifcx` | detail editor | v1 assignments carried to v2 occurrences via the lineage |
| (not a layer) | `ifc-lite/model-v1.ifc`, `model-v2.ifc` | `generate.py` | IFC STEP twins of the two models, for ifc-lite |
| (not a layer) | `ifc-lite/lineage-v1-v2.json` | ifc-lite 0.45.1 | Lineage sidecar from diffing the twins |

Model v2 is a full re-export, not a layer on top of v1. That is the hard case:
new paths for every changed element.

`generate.py` writes all eight `.ifcx` files and the two STEP twins. To change
the example, edit the script and run it in this folder (Python 3.8 or later,
no packages):

```sh
python3 generate.py
```

It writes next to itself and is deterministic, so an unchanged script gives
the committed files byte for byte. If a change touches the model, the STEP
twins change too and the script stops until the lineage sidecar is rerun
(Node 20 or later):

```sh
cd ifc-lite && npx -y @ifc-lite/cli@0.45.1 diff model-v1.ifc model-v2.ifc --geometry --split-merge --lineage-out lineage-v1-v2.json
```

## How each IFCX mechanism is used

- **children**: the model storey lists its walls, the derivation layer lists its
  occurrences under one group node, and the catalog nests versions under each
  type (`<catalog>/D012/v3`).
- **inherits**: the assignment is `"inherits": {"detailType": "<catalog>/D012/v3"}`
  on the occurrence. Composition copies the type's attributes onto the
  occurrence, so the composed occurrence shows code, name and version. The
  version is a path segment of the reference, so pinning a version is just
  choosing the path. (pointed at `src/ifcx-core/composition/compose.ts:143`)
- **attributes**: members (`ref` + `role`), topology (junction kind, line
  extent), the derivation record, the assignment state, and the lineage are
  all namespaced attributes with schemas declared in the layer that writes
  them. Wrong enum values are rejected. (proven by running: a lineage with
  `"relation": "teleported"` fails composition)
- **layering**: each writer owns one file. The assignment is an opinion about
  a node that another tool wrote, without editing that tool's file. Layer
  order does not matter in this example: no two layers write the same
  attribute on the same path, so the rule that later layers win
  (`src/ifcx-core/composition/compose.ts:17`) never applies. (proven by
  running: the v2 stack in reverse order composes to the same JSON, and
  `npm test` checks it)

### Occurrence identity

An occurrence path is a pure function of its inputs, so re-deriving the same
model gives the same paths:

```
ns   = uuid5(NAMESPACE_URL, "dokwood.example/timber-junction")
path = uuid5(ns, "occurrence|slab-on-wall|" + "|".join(sorted(member_paths)))
```

The member paths are the wall and slab paths, themselves
`uuid5(ns, "element|<GlobalId>")`. Example: Wand 3 (`14669707-...`) and the
slab (`05b23ede-...`) give `68b553da-3631-54b8-a33a-6b1a8a0338a6`.
(proven by running) Consequence, visible in v2:

- Wand 3 and the slab kept their paths, so the Wand 3 occurrence kept its path
  and the v1 assignment (D021, approved) applies without any lineage.
  (proven by running)
- Every other occurrence got a new path. Its assignment survives only because
  `4-assignment-v2.ifcx` restates it on the new path, with `carriedFrom`
  naming the old occurrence, the lineage node, the relation and the policy
  (`copy-to-all`). Split successors are set to `to-confirm`. (proven by running)

### Derivation record

`dokwood::derivation` generalizes `bsi::ifc::geometry::brep::derived_from`,
an attribute proposed for Boolean geometry output (not in this repo):
`operation`, `engine`, `engineVersion`, `tolerance`, `sources`
(paths), plus `sourceLayer` and `sourceSha256` so a consumer can tell which
model version an occurrence was derived from.

### Lineage

`dokwood::lineage` is the `ifc-lite/lineage` v1 sidecar translated to IFCX:
`base` and `head`, `entries` with lists of predecessors and successors,
`relation`, `evidence`, optional `shares`, and `deleted`. ifc-lite reads IFC
STEP, not IFCX (`ifc-lite diff 1-model-v1.ifcx 1-model-v2.ifcx` fails with
"is not a valid IFC/STEP file"), so the entries come from diffing STEP twins
of the two models. `generate.py` writes the twins with the same GlobalIds,
names, `IsExternal` and boxes as the IFCX models, reads
`ifc-lite/lineage-v1-v2.json`, checks that its hashes match the twins it just
wrote, and copies relation, reason and shares verbatim, with GlobalIds turned
into IFCX paths. (proven by running: `@ifc-lite/cli` 0.45.1 from npm, command
above, gave a split of Wand 1 with shares 2/3 and 1/3, and Wand 2 and Wand 4
as `identity` with reasons `content-match:renamed` and `content-match:moved`)

What is not from ifc-lite: the IFCX paths, `sidecar` (file and SHA-256 of
the ifc-lite output), and `base` and `head`, which hold the SHA-256 of
`1-model-v1.ifcx` and `1-model-v2.ifcx` rather than of the twins. (proven by
running: a test recomputes all of them and the twin hashes in the sidecar,
and compares the entries with the sidecar, resolving each GlobalId to a path
by wall name)
The twins and the IFCX models take their boxes from the same function in
`generate.py`, but nothing compares the two.

## Compose it

```sh
cd src && npm install
npx esbuild ifcx-cli/ifcx-cli.ts --bundle --outfile=ifcx-cli.js --external:three --platform=node
cd "../examples/Timber Junction"
out=$(mktemp -d)
node ../../src/ifcx-cli.js compose 1-model-v1.ifcx 2-catalog.ifcx 3-derivation-v1.ifcx 4-assignment-v1.ifcx "$out/v1.json"
node ../../src/ifcx-cli.js compose 1-model-v2.ifcx 2-catalog.ifcx 3-derivation-v2.ifcx 4-assignment-v1.ifcx 4-lineage-v1-v2.ifcx 4-assignment-v2.ifcx "$out/v2.json"
```

The composed JSON goes to a fresh temp folder, because `compose` refuses to
overwrite an existing output file.

The model layers import `ifc`, `prop` and `usd`, which are fetched from
ifcx.dev. Schema validation is on. `npm test` composes both stacks too
(`example file::timber junction ...`).

Composed occurrences (paths shortened):

```
v1  Wand_1__Decke    D012/v3  approved
    Wand_2__Decke    D012/v3  in-review
    Wand_3__Decke    D021/v1  approved
    Wand_4__Decke    (no type)

v2  Wand_1_1__Decke  D012/v3  to-confirm   carriedFrom c876b170 (split)
    Wand_1_2__Decke  D012/v3  to-confirm   carriedFrom c876b170 (split)
    Wand_2__Decke    D012/v3  in-review    carriedFrom d5a65e9f (identity)
    Wand_3__Decke    D021/v1  approved     (same path as v1)
    Wand_4__Decke    (no type)
    root c876b170    D012/v3  approved     no members  <- orphan
    root d5a65e9f    D012/v3  in-review    no members  <- orphan
```

The web viewer (`web/viewer`, built from `src/viewer` with the
`build-viewer` esbuild command) loads the six v2 layers in the order above and
renders the five walls and the translucent slab. (proven by running: headless
Chrome, no console errors except a 404 for `favicon.ico` from the static file
server)

## Open gaps

1. **Orphaned opinions after re-derivation.** `4-assignment-v1.ifcx` still
   speaks about the v1 occurrences of Wand 1 and Wand 2. Nothing derives those
   paths any more, so composition turns each into a new root node that has a
   type and a state but no members. IFCX has no rule to flag or drop such a
   node, and a later layer cannot delete a node. (proven by running; root
   detection at `src/ifcx-core/composition/cycles.ts:50`) Nulling the
   orphan's `inherits` entry composes, but the root stays, with its state and
   no type. Nulling its `dokwood::detail::assignment` attribute crashes
   validation with a TypeError at
   `src/ifcx-core/schema/schema-validation.ts:93`: the Object check passes
   because `typeof null` is `"object"`, then `Object.hasOwn(null, ...)` throws.
   (both proven by running) That validator bug is a separate fix, not part of
   this example.
2. **A section along an edge as reference target.** The extent is a line given
   by coordinates inside an attribute. A path can name a node (a wall, or a
   Brep edge on the geometry-tiers branch) but not a stretch of it, such as
   "edge E from 0.0 to 4.0 m". An occurrence interrupted at a door would need
   that. (unproven that no workaround exists; no IFCX construct for it found)
3. **n-ary junction node.** The occurrence holds its members as a list of
   `{ref, role}` in an attribute. To IFCX these refs are strings: the
   validator only checks the type (`src/ifcx-core/schema/schema-validation.ts:76`)
   and a member ref pointing at a missing node composes without error.
   (proven by running) `sourceLayer` and `sourceSha256` are not checked
   either: `3-derivation-v2.ifcx` and `4-assignment-v2.ifcx` stacked on
   `1-model-v1.ifcx` compose with exit 0. (proven by running) `children` would give resolution but means
   containment, and a node listed as child of two walls is copied into both
   (pointed at `src/ifcx-core/composition/compose.ts:160`).
4. **Lineage binding is to file bytes.** The header has no content hash, so the
   SHA-256 breaks if a file is reformatted without any data change. (pointed
   at `schema/ifcx.tsp:21`, the header has id, versions, author and timestamp
   only) Nothing checks the binding either: `base.sha256` and `head.sha256`
   are not compared with the stacked layers, and a lineage entry with a
   predecessor that is no node at all and `shares` of `[0.9, 0.9]` composes.
   (proven by running)
5. **Carrying is manual.** `4-assignment-v2.ifcx` was written by applying the
   lineage outside IFCX. No IFCX mechanism applies a lineage to opinions.
6. **An approval is not tied to the derivation it reviewed.** The Wand 3
   occurrence `68b553da` has `sourceSha256` `476b...` in v1 and `e79c...` in
   v2, yet the v1 approval applies to it unchanged, because its path depends
   only on the member paths. A reviewer approved a derivation from v1; the
   composed v2 says approved for a derivation from v2. (proven by running)
7. **Nothing orders opinions after their subject.** IFCX does not require an
   opinion layer to come after the layer it refers to. The v2 stack with
   `4-assignment-v2.ifcx` first and `1-model-v2.ifcx` last composes without
   error. (proven by running)

## What would be proposed under bsi::

- `bsi::derivation` for any derived node: operation, engine, version,
  tolerance, sources, source layer and hash. Would subsume the geometry-only
  `derived_from`.
- `bsi::junction` (or similar) for a node joining several elements: members
  with role, junction kind, extent. Needs a real reference type that the
  validator resolves.
- `bsi::lineage` as a layer kind or header block: predecessors, successors,
  relation (identity, split, merge, replaced, as in ifc-lite), evidence,
  shares, bound to content hashes of both versions.
- A composition rule for opinions about nodes that no longer exist.

The detail types and their catalog stay in a domain namespace; they are not a
buildingSMART concern.
