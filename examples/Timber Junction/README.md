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

Model v2 is a full re-export, not a layer on top of v1. That is the hard case:
new paths for every changed element.

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
  a node that another tool wrote, without editing that tool's file. Stacking
  order decides who wins; later layers win.
  (pointed at `src/ifcx-core/composition/compose.ts:17`)

### Occurrence identity

An occurrence path is a UUIDv5 of the junction kind and the sorted member
paths, so re-deriving the same model gives the same paths. This follows the
naming rule in `docs/boolean-output-identity.md` (name is a pure function of
the inputs). Consequence, visible in v2:

- Wand 3 and the slab kept their paths, so the Wand 3 occurrence kept its path
  and the v1 assignment (D021, approved) applies without any lineage.
  (proven by running)
- Every other occurrence got a new path. Its assignment survives only because
  `4-assignment-v2.ifcx` restates it on the new path, with `carriedFrom`
  naming the old occurrence, the lineage node, the relation and the policy
  (`copy-to-all`). Split successors are set to `to-confirm`. (proven by running)

### Derivation record

`dokwood::derivation` generalizes `bsi::ifc::geometry::brep::derived_from`
from that doc: `operation`, `engine`, `engineVersion`, `tolerance`, `sources`
(paths), plus `sourceLayer` and `sourceSha256` so a consumer can tell which
model version an occurrence was derived from.

### Lineage

`dokwood::lineage` mirrors the `ifc-lite/lineage` v1 sidecar: `base` and
`head` bound by SHA-256, `entries` with lists of predecessors and successors,
`relation`, `evidence`, optional `shares`, and `deleted`. Differences from
ifc-lite: references are IFCX paths instead of GlobalIds, and `renamed` and
`moved` are relations here, where ifc-lite uses `identity` with reason
`content-match:renamed` / `content-match:moved`. The entries were transcribed
from the demo output, not produced by running ifc-lite on these files
(unproven that ifc-lite can diff IFCX).

The hashes are over the exact bytes of `1-model-v1.ifcx` and
`1-model-v2.ifcx`. (proven by running: a test recomputes them)

## Compose it

```sh
cd src && npm install
npx esbuild ifcx-cli/ifcx-cli.ts --bundle --outfile=ifcx-cli.js --external:three --platform=node
cd "../examples/Timber Junction"
node ../../src/ifcx-cli.js compose 1-model-v1.ifcx 2-catalog.ifcx 3-derivation-v1.ifcx 4-assignment-v1.ifcx v1.json
node ../../src/ifcx-cli.js compose 1-model-v2.ifcx 2-catalog.ifcx 3-derivation-v2.ifcx 4-assignment-v1.ifcx 4-lineage-v1-v2.ifcx 4-assignment-v2.ifcx v2.json
```

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
    Wand_2__Decke    D012/v3  in-review    carriedFrom d5a65e9f (renamed)
    Wand_3__Decke    D021/v1  approved     (same path as v1)
    Wand_4__Decke    (no type)
    root c876b170    D012/v3  approved     no members  <- orphan
    root d5a65e9f    D012/v3  in-review    no members  <- orphan
```

The web viewer (`src/viewer`) loads the six v2 layers and renders the walls
and slab. (proven by running, in a local build of the viewer)

## Open gaps

1. **Orphaned opinions after re-derivation.** `4-assignment-v1.ifcx` still
   speaks about the v1 occurrences of Wand 1 and Wand 2. Nothing derives those
   paths any more, so composition turns each into a new root node that has a
   type and a state but no members. IFCX has no rule to flag or drop such a
   node, and a later layer cannot delete a node, only null its children,
   inherits or attributes. (proven by running; root detection at
   `src/ifcx-core/composition/cycles.ts:50`)
2. **A section along an edge as reference target.** The extent is a line given
   by coordinates inside an attribute. A path can name a node (a wall, or a
   Brep edge on the geometry-tiers branch) but not a stretch of it, such as
   "edge E from 0.0 to 4.0 m". An occurrence interrupted at a door would need
   that. (unproven that no workaround exists; no IFCX construct for it found)
3. **n-ary junction node.** The occurrence holds its members as a list of
   `{ref, role}` in an attribute. To IFCX these refs are strings: the
   validator only checks the type (`src/ifcx-core/schema/schema-validation.ts:76`)
   and a member ref pointing at a missing node composes without error.
   (proven by running) `children` would give resolution but means
   containment, and a node listed as child of two walls is copied into both
   (pointed at `src/ifcx-core/composition/compose.ts:160`).
4. **Lineage binding is to file bytes.** The header has no content hash, so the
   SHA-256 breaks if a file is reformatted without any data change. (pointed
   at `schema/ifcx.tsp:21`, the header has id, versions, author and timestamp
   only)
5. **Carrying is manual.** `4-assignment-v2.ifcx` was written by applying the
   lineage outside IFCX. No IFCX mechanism applies a lineage to opinions.

## What would be proposed under bsi::

- `bsi::derivation` for any derived node: operation, engine, version,
  tolerance, sources, source layer and hash. Would subsume the geometry-only
  `derived_from`.
- `bsi::junction` (or similar) for a node joining several elements: members
  with role, junction kind, extent. Needs a real reference type that the
  validator resolves.
- `bsi::lineage` as a layer kind or header block: predecessors, successors,
  relation (split, merge, renamed, moved, replaced), evidence, shares, bound
  to content hashes of both versions.
- A composition rule for opinions about nodes that no longer exist.

The detail types and their catalog stay in a domain namespace; they are not a
buildingSMART concern.
