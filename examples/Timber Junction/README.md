# Timber Junction

A worked example of a **derived object that carries data**: a detail occurrence
(where a timber slab bears on a wall) is derived by a tool, gets a detail type
assigned by a person, and has to keep that assignment when the architect
re-exports the model with new identifiers.

The scenario is the four-wall case from the DOKwood WP9 identity demo. In v2,
Wand 1 is split at 4 m into Wand 1.1 and Wand 1.2, Wand 2 has a new identity
only, Wand 3 is unchanged, and Wand 4 has a new identity and moved 0.50 m.
A slab (Decke über EG) sits on all four walls and is unchanged. Outside Wand 2
a balcony slab is two pieces in v1 (Balkonplatte A and B) and one piece in v2
(Balkonplatte), a merge.

A second, smaller scenario (`v2-samename`) is the same v2 except that both
pieces of Wand 1 keep the old name "Wand 1". ifc-lite does not find that split.

Claims are marked: proven by running (a command or a named `npm test` case),
pointed at `file:line`, or unproven.

All example attributes use the `dokwood::` namespace. They are not part of IFCX.
See "What would be proposed under bsi::" below.

## Files

| Layer | File | Written by | Contains |
|---|---|---|---|
| 1 model | `1-model-v1.ifcx`, `1-model-v2.ifcx` | authoring tool | Storey, 4 (v2: 5) walls, floor slab, 2 (v2: 1) balcony slabs, box meshes |
| 1 model | `1-model-v2-samename.ifcx` | authoring tool | v2 with both Wand 1 pieces named "Wand 1" |
| 2 catalog | `2-catalog.ifcx` | detail catalog | Detail types D012 (v2, v3), D021 (v1), D031 (v1) with roles |
| 3 derivation | `3-derivation-v1.ifcx`, `3-derivation-v2.ifcx` | detail finder | One occurrence node per wall/slab and slab/balcony junction |
| 4 assignment | `4-assignment-v1.ifcx` | detail editor | Type assignment, review state, reviewed derivation hash |
| 4 manual | `4-manual-split.ifcx` | planner | Wand 2 occurrence split in two at a balcony door, written against v1 |
| 4 provenance | `4-lineage-v1-v2.ifcx` | model comparison | Lineage from v1 to v2 elements |
| 4 assignment | `4-assignment-v2.ifcx` | detail editor | v1 assignments carried to v2 occurrences, stale approvals reset |
| 4 provenance | `4-lineage-v1-v2-samename.ifcx` | model comparison | Lineage from v1 to v2-samename, as ifc-lite found it |
| 4 provenance | `4-lineage-v1-v2-samename-manual.ifcx` | planner | The split ifc-lite missed, `source: manual` |
| (not a layer) | `ifc-lite/model-*.ifc` | `generate.py` | IFC STEP twins of the three models, for ifc-lite |
| (not a layer) | `ifc-lite/lineage-v1-*.json` | ifc-lite 0.45.1 | Lineage sidecars from diffing the twins |
| (not a layer) | `ifc-lite/lineage-corpus-r09-r10.json` | ifc-lite 0.45.1 | Lineage sidecar of a real corpus pair, see the last section |

Model v2 is a full re-export, not a layer on top of v1. That is the hard case:
new paths for every changed element.

`generate.py` writes all twelve `.ifcx` files and the three STEP twins, and
copies the two lineage sidecars it read into the output folder. Everything
except the STEP twins is written last, after every check has passed. To
change the example, edit the script and run it in this folder (Python 3.8 or
later, no packages):

```sh
python3 generate.py
```

It writes next to itself and is deterministic, so an unchanged script gives
the committed files byte for byte. (proven by running: `python3 generate.py
<empty folder>` and `cmp` of every file) If a change touches a model, the STEP
twins change too and the script stops until the lineage sidecars are rerun
(Node 20 or later):

```sh
cd ifc-lite
npx -y @ifc-lite/cli@0.45.1 diff model-v1.ifc model-v2.ifc --geometry --split-merge --lineage-out lineage-v1-v2.json
npx -y @ifc-lite/cli@0.45.1 diff model-v1.ifc model-v2-samename.ifc --geometry --split-merge --lineage-out lineage-v1-v2-samename.json
```

## How each IFCX mechanism is used

- **children**: the model storey lists its elements, the derivation layer lists
  its occurrences under one group node, the catalog nests versions under each
  type (`<catalog>/D012/v3`), and the manual split adds two parts as children
  of the occurrence it splits.
- **inherits**: the assignment is `"inherits": {"detailType": "<catalog>/D012/v3"}`
  on the occurrence. Composition copies the type's attributes onto the
  occurrence, so the composed occurrence shows code, name and version. The
  version is a path segment of the reference, so pinning a version is just
  choosing the path. (pointed at `src/ifcx-core/composition/compose.ts:143`)
- **attributes**: members (`ref` + `role`), topology (junction kind, line
  extent), the derivation record, the assignment, the manual split and the
  lineage are all namespaced attributes with schemas declared in the layer
  that writes them. Wrong enum values are rejected. (proven by running: a
  lineage with `"relation": "teleported"` fails composition)
- **layering**: each writer owns one file. The assignment is an opinion about
  a node that another tool wrote, without editing that tool's file. A later
  layer replaces a whole attribute of an earlier one on the same path
  (`src/ifcx-core/composition/compose.ts:52`). In the v2 stack that happens
  exactly once, see "Layer order" below.

### Occurrence identity

An occurrence path is a pure function of its inputs, so re-deriving the same
model gives the same paths:

```
ns   = uuid5(NAMESPACE_URL, "dokwood.example/timber-junction")
path = uuid5(ns, "occurrence|<junction kind>|" + "|".join(sorted(member_paths)))
```

The member paths are the element paths, themselves
`uuid5(ns, "element|<GlobalId>")`. Example: Wand 3 (`14669707-...`) and the
slab (`05b23ede-...`) give `68b553da-3631-54b8-a33a-6b1a8a0338a6`.
(proven by running) Consequence, visible in v2:

- Wand 3 and the slab kept their paths, so the Wand 3 occurrence kept its path
  and the v1 assignment applies to it without any lineage. Its approval does
  not, see the next section. (proven by running)
- Every other occurrence got a new path. Its assignment survives only because
  `4-assignment-v2.ifcx` restates it on the new path, with `carriedFrom`
  naming the old occurrences, the lineage node, the relation and the policy.
  (proven by running: `timber junction composes v1 and v2 layer stacks`)

### Derivation record

`dokwood::derivation` generalizes `bsi::ifc::geometry::brep::derived_from`,
an attribute proposed for Boolean geometry output (not in this repo):
`operation`, `engine`, `engineVersion`, `tolerance`, `sources`
(paths), plus `sourceLayer` and `sourceSha256` so a consumer can tell which
model version an occurrence was derived from.

### Approval bound to the derivation

An approval stores `reviewedSha256`, the SHA-256 of the derivation record it
approved, taken over sorted compact JSON with whole floats written as
integers (`record_sha` in `generate.py`). That matches `JSON.stringify` for
the values here, but it is not a general canonical form; RFC 8785 would be.
An approval sets it, and it stays when the approval drops to `to-confirm`, to
show what was approved. `in-review` and `proposed` never have one. (proven by
running, same test as below)

The rule: `approved` needs `reviewedSha256` equal to the hash of the
occurrence's current derivation record, and a `reviewedSha256` that differs
needs `to-confirm`. `generate.py` applies it when it writes
`4-assignment-v2.ifcx` (`carried_state`), and `npm test` checks it on every
derived occurrence of both stacks. (proven by running: `timber junction
approvals hold only for the derivation they reviewed`) It cannot be checked
on the orphan roots of gap 1: they have no derivation record, and two of them
still say `approved`. (proven by running)

The Wand 3 occurrence `68b553da` keeps its path, but its derivation record
has `sourceSha256` `7a3e9751...` in v1 and `4d106680...` in v2, so its record
hash goes from `addfdad6...` to `5568cd08...`. The v1 approval reviewed
`addfdad6...`, so `4-assignment-v2.ifcx` writes `to-confirm` on the same path
and keeps `reviewedSha256` to show what was approved. (proven by running) The
split successors of Wand 1 carry the stale hash too and are `to-confirm`.

This is a convention. IFCX composes an `approved` state with a stale
`reviewedSha256` without complaint: the swapped order below does exactly
that. (proven by running)

### Layer order

`4-assignment-v1.ifcx` says `approved` for the Wand 3 occurrence and
`4-assignment-v2.ifcx` says `to-confirm`, both as
`dokwood::detail::assignment` on `68b553da`. It is the only attribute that
two layers of the v2 stack write on the same path. Both layers also write
`inherits.detailType` there, with the same value D021/v1, so it cannot differ
by order. (proven by running) The later layer wins:

| Order | Wand 3 composes to |
|---|---|
| as committed, `4-assignment-v2` after `4-assignment-v1` | `D021/v1 to-confirm` |
| `4-assignment-v1` moved to the end | `D021/v1 approved` |

All other occurrences compose the same in both orders. (proven by running:
`timber junction layer order decides the Wand 3 review state`) So the stack
order is part of the meaning: whoever builds the stack decides whether a
stale approval shows.

### Lineage

`dokwood::lineage` is the `ifc-lite/lineage` v1 sidecar translated to IFCX:
`base` and `head`, `entries` with lists of predecessors and successors,
`relation`, `evidence`, optional `shares`, `source`, and `deleted`. ifc-lite
reads IFC STEP, not IFCX (`ifc-lite diff 1-model-v1.ifcx 1-model-v2.ifcx`
fails with "is not a valid IFC/STEP file"), so the entries come from diffing
STEP twins of the models. `generate.py` writes the twins, reads
`ifc-lite/lineage-v1-<head>.json`, checks that its hashes match the twins it
just wrote, and copies relation, reason and shares verbatim, with GlobalIds
turned into IFCX paths and `source: "ifc-lite"`.

What ifc-lite reported for v1 to v2 (proven by running: `@ifc-lite/cli`
0.45.1 from npm, command above; 6 unchanged, 3 added, 3 deleted):

| Predecessors | Successors | Relation | Reason | Shares |
|---|---|---|---|---|
| Balkonplatte A, Balkonplatte B | Balkonplatte | merge | `merge:verified` | 0.5, 0.5 |
| Wand 1 | Wand 1.1, Wand 1.2 | split | `split:verified` | 2/3, 1/3 |
| Wand 2 | Wand 2 | identity | `content-match:renamed` | |
| Wand 4 | Wand 4 | identity | `content-match:moved` | |

What is not from ifc-lite: the IFCX paths, `source`, `sidecar` (file and
SHA-256 of the ifc-lite output), and `base` and `head`, which hold the SHA-256
of the IFCX models rather than of the twins. (proven by running: `timber
junction lineages and derivations are bound to the model files` recomputes
the hashes in all three lineage layers and both derivations, and compares the
entries with the sidecars, turning each GlobalId
into its path with uuid5 and requiring that path to be a node of the model)

### Twin check

The STEP twins and the IFCX models agree per wall and slab: the same
GlobalIds (as `uuid5` paths), names, class, `IsExternal` and boxes (origin
plus extruded rectangle against the mesh's bounding box, to 6 decimals), for
all three models. The twins write millimetres, and `generate.py` refuses a
box that is finer. (proven by running: `timber junction STEP twins match the
IFCX models`, which also fails if an element's origin in a twin is changed)
The test reads each element's own origin, profile and depth only. The shared
placement chain and axis directions (`#20` to `#35`) are assumed to be the
identity, as `generate.py` writes them, and are not checked. Spatial
containment and property set names are not compared either. (unproven)

### Merge (n:1)

The two balcony pieces have one occurrence each against the floor slab
(junction `slab-to-slab`, type D031), A `approved` and B `in-review`. In v2
the merged balcony has one occurrence on a new path.

Carry policy `same-type-or-none`: a merge successor gets the type only when
every predecessor had an assignment with the same type and version; its state
is always `to-confirm` and it has no `reviewedSha256`, since no single record
was reviewed. Here both are D031/v1, so the merged occurrence gets D031/v1
`to-confirm`, with `carriedFrom.occurrences` listing both old occurrences.
(proven by running: `timber junction carries merges by same-type-or-none`,
which checks the rule for every merge entry) If they disagree, nothing is
carried (pointed at `generate.py:549`; unproven, the example has no such case).

Every other relation uses `copy-to-all`: every successor gets the type. Only
an `identity` successor keeps its state, unless the approval rule resets it;
any other successor is `to-confirm` (pointed at `generate.py:557`; `replaced`
is unproven, the example has none).

### Pieces keep the old name

In `v2-samename` both Wand 1 pieces are named "Wand 1". ifc-lite does not
report the split (proven by running: second command above, `--json`):

- content matches: Wand 2 `renamed`, Wand 4 `moved`, and Wand 1 to Wand 1.1
  `reshaped`, so the lineage says `identity`, `content-match:reshaped`, from
  Wand 1 to the larger piece only;
- split/merge claims: the balcony merge only;
- the smaller piece (`2WandW1bNeuTeilstueckB`) is in no lineage entry, so it
  would get no data.

This matches the edge case noted in the WP9 identity demo. The human-confirmed
path: `4-lineage-v1-v2-samename-manual.ifcx` is a separate layer, written by
the planner, with one entry Wand 1 to both pieces, `relation: "split"`,
`source: "manual"`, `author` and `timestamp`, and no shares. The ifc-lite
layer stays as it was produced.

Both lineage nodes compose side by side; IFCX cannot drop one entry from
another layer's `entries` list. The rule that a manual entry replaces every
ifc-lite entry naming one of its elements is a convention, applied in the test
(`EffectiveLineage` in `src/test/example-file-test.ts`). With it, every
element new in v2-samename has a predecessor; without it, Wand 1.2 has none.
(proven by running: `timber junction: ifc-lite misses a split whose pieces
keep the old name, a manual entry states it`) The example does not carry
assignments for v2-samename.

### Manual split and re-derivation

`4-manual-split.ifcx` is a person's edit against v1: the Wand 2 occurrence
`d5a65e9f` gets `dokwood::detail::manualSplit` (reason, author, timestamp) and
two child parts, x 0.00 to 2.50 and 3.50 to 6.00, for a balcony door between
them. The layer stays in the v2 stack. Composed result (proven by running:
`timber junction manual split of the Wand 2 occurrence is orphaned when Wand 2
is re-derived`):

- v1: the Wand 2 occurrence has the split and both parts.
- v2: Wand 2 has a new GlobalId, so the re-derived occurrence has a new path
  (`c186e4d2`). It has no split and no parts. The split lands on the old path
  `d5a65e9f`, which is now a root with no members: an orphan, visible next to
  the orphaned assignment on the same path. Its parts still name the v1 Wand 2,
  which is no node of model v2.

The split does not follow the lineage; nothing in this example carries manual
edits. A split on an occurrence whose path survives (like Wand 3) would stay
attached, with the same stale-derivation problem as an approval. (unproven,
not in the example)

## Compose it

```sh
cd src && npm install
npx esbuild ifcx-cli/ifcx-cli.ts --bundle --outfile=ifcx-cli.js --external:three --platform=node
cd "../examples/Timber Junction"
out=$(mktemp -d)
node ../../src/ifcx-cli.js compose 1-model-v1.ifcx 2-catalog.ifcx 3-derivation-v1.ifcx 4-assignment-v1.ifcx 4-manual-split.ifcx "$out/v1.json"
node ../../src/ifcx-cli.js compose 1-model-v2.ifcx 2-catalog.ifcx 3-derivation-v2.ifcx 4-assignment-v1.ifcx 4-manual-split.ifcx 4-lineage-v1-v2.ifcx 4-assignment-v2.ifcx "$out/v2.json"
node ../../src/ifcx-cli.js compose 1-model-v2-samename.ifcx 4-lineage-v1-v2-samename.ifcx 4-lineage-v1-v2-samename-manual.ifcx "$out/v2-samename.json"
```

The composed JSON goes to a fresh temp folder, because `compose` refuses to
overwrite an existing output file.

The model layers import `ifc`, `prop` and `usd`, which are fetched from
ifcx.dev. Schema validation is on. `npm test` composes the same stacks
(`example file::timber junction ...`).

Composed occurrences (paths shortened):

```
v1  Wand_1__Decke          D012/v3  approved
    Wand_2__Decke          D012/v3  in-review    manual split into Teil_1, Teil_2
    Wand_3__Decke          D021/v1  approved
    Wand_4__Decke          (no type)
    Decke__Balkonplatte_A  D031/v1  approved
    Decke__Balkonplatte_B  D031/v1  in-review

v2  Wand_1_1__Decke        D012/v3  to-confirm   carriedFrom c876b170 (split)
    Wand_1_2__Decke        D012/v3  to-confirm   carriedFrom c876b170 (split)
    Wand_2__Decke          D012/v3  in-review    carriedFrom d5a65e9f (identity), no split
    Wand_3__Decke          D021/v1  to-confirm   stale approval, same path as v1
    Wand_4__Decke          (no type)
    Decke__Balkonplatte    D031/v1  to-confirm   carriedFrom 29fc8807 + efea72a9 (merge)
    root c876b170          D012/v3  approved     no members  <- orphan
    root d5a65e9f          D012/v3  in-review    no members, manual split  <- orphan
    root 29fc8807          D031/v1  approved     no members  <- orphan
    root efea72a9          D031/v1  in-review    no members  <- orphan
```

The web viewer (`web/viewer`, built from `src/viewer` with the
`build-viewer` esbuild command) loaded the earlier six-layer v2 stack and
rendered the walls and the translucent slab (proven by running at the
previous commit, headless Chrome). Not rerun for the current seven-layer
stack with the balcony. (unproven)

## Open gaps

1. **Orphaned opinions after re-derivation.** `4-assignment-v1.ifcx` still
   speaks about the v1 occurrences of Wand 1, Wand 2 and the two balcony
   pieces, and `4-manual-split.ifcx` about Wand 2. Nothing derives those paths
   any more, so composition turns each into a new root node with a type, a
   state, or a split, but no members. IFCX has no rule to flag or drop such a
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
   "edge E from 0.0 to 4.0 m". The manual split works around it with
   coordinates in each part. (unproven that no workaround exists; no IFCX
   construct for it found)
3. **n-ary junction node.** The occurrence holds its members as a list of
   `{ref, role}` in an attribute. To IFCX these refs are strings: the
   validator only checks the type (`src/ifcx-core/schema/schema-validation.ts:78`)
   and a member ref pointing at a missing node composes without error.
   (proven by running; the manual split parts in v2 are such a case)
   `sourceLayer` and `sourceSha256` are not checked either:
   `3-derivation-v2.ifcx` and `4-assignment-v2.ifcx` stacked on
   `1-model-v1.ifcx` compose with exit 0. (proven by running) `children`
   would give resolution but means containment, and a node listed as child of
   two walls is copied into both (pointed at
   `src/ifcx-core/composition/compose.ts:160`).
4. **Lineage binding is to file bytes.** The header has no content hash, so the
   SHA-256 breaks if a file is reformatted without any data change. (pointed
   at `schema/ifcx.tsp:21`, the header has id, versions, author and timestamp
   only) Nothing checks the binding either: `base.sha256` and `head.sha256`
   are not compared with the stacked layers, and a lineage entry with a
   predecessor that is no node at all and `shares` of `[0.9, 0.9]` composes.
   (proven by running) A manual entry cannot replace an ifc-lite entry inside
   IFCX, because `entries` is one attribute; see "Pieces keep the old name".
   (proven by running)
5. **Carrying is manual.** `4-assignment-v2.ifcx` was written by applying the
   lineage outside IFCX, with policies `copy-to-all` and `same-type-or-none`.
   No IFCX mechanism applies a lineage to opinions, and nothing carries the
   manual split. (proven by running for the split)
6. **An approval is not tied to the derivation it reviewed, except by
   convention.** Without `reviewedSha256` the v1 approval of Wand 3 applied
   unchanged to a derivation from v2, because the occurrence path depends only
   on the member paths. (proven by running at the previous commit) The remedy
   is shown: approvals store `reviewedSha256`, the generator resets stale ones
   to `to-confirm`, and the test enforces the rule. (proven by running) It is
   not enforced in IFCX: the stack with `4-assignment-v1.ifcx` last composes
   to `approved` with a stale hash, without error. (proven by running)
7. **Nothing orders opinions after their subject.** IFCX does not require an
   opinion layer to come after the layer it refers to. The v2 stack with
   `4-assignment-v2.ifcx` first and `1-model-v2.ifcx` last composes without
   error. (proven by running) Combined with
   the layer-order case above, the stack order is part of the meaning and
   nothing checks it.

## Real corpus case: r09 to r10 partition-wall split

The ifc-lite revision corpus (`tools/ifc-git-corpus` in the ifc-lite
repository, manifest `revisions.json`, issue 8197) derives a chain of
revisions from `apps/viewer/public/samples/building-architecture.ifc`. In
r10 one 4 m partition wall is replaced by two adjacent 2 m walls with
identical data; the manifest notes that 1-to-2 content matching must abstain.
The IFC files are not committed here (226 kB each):

| Revision | File | SHA-256 |
|---|---|---|
| r09 | `building-architecture-r09.ifc` | `6b83bd45c297b545a45fc8a1d331a19380a4b9302f9e1a467ad8a68f25d08d17` |
| r10 | `building-architecture-r10.ifc` | `b47e05a7a1cadc4bdc4ec7f5ffa98866c6e62265dc509dedc2fcc7a11caf885e` |

Both hashes match the manifest. Command, in a folder with both files:

```sh
npx -y @ifc-lite/cli@0.45.1 diff building-architecture-r09.ifc building-architecture-r10.ifc --geometry --split-merge --lineage-out lineage-corpus-r09-r10.json
```

Result, committed as `ifc-lite/lineage-corpus-r09-r10.json` (proven by
running; the sidecar's base and head hashes are the two above):

- counts: 39 unchanged, 0 modified, 2 added, 1 deleted;
- content matches: one `duplicated` from `2tsdtNmQj7tRjIX4ABManr` to both new
  walls, which ifc-lite does not resolve; content matching abstains, as the
  manifest requires;
- split/merge claims: one `split`, confidence `verified`;
- lineage: one entry, `2tsdtNmQj7tRjIX4ABManr` to `0KkLs7PeT5xeBRlY1ixJUZ`
  and `2fdw0DJf9FhApKd3dUa4tH`, `relation: "split"`, `reason:
  "split:verified"`, `shares` 0.5 and 0.5.

All three walls are named "Corpus partition wall". Unlike `v2-samename`, the
pieces here are equal, so content matching abstains instead of picking one,
and the geometry split check decides. The sidecar is not translated into an
IFCX layer, since the corpus has no IFCX model.

## What would be proposed under bsi::

- `bsi::derivation` for any derived node: operation, engine, version,
  tolerance, sources, source layer and hash. Would subsume the geometry-only
  `derived_from`.
- `bsi::junction` (or similar) for a node joining several elements: members
  with role, junction kind, extent. Needs a real reference type that the
  validator resolves.
- `bsi::lineage` as a layer kind or header block: predecessors, successors,
  relation (identity, split, merge, replaced, as in ifc-lite), evidence,
  shares, source (tool or person), bound to content hashes of both versions.
  Entries as separate nodes would let a manual entry replace a tool entry by
  layer order. (unproven)
- A review binding: an opinion that names the hash of the record it judged,
  and a rule that it lapses when that record changes.
- A composition rule for opinions about nodes that no longer exist.

The detail types and their catalog stay in a domain namespace; they are not a
buildingSMART concern.
