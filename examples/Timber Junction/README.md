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
| 0 federation | `0-federation-bp.ifcx` | BIM coordinator | No data; imports both BP models with `integrity` |
| 1 model | `1-model-mep.ifcx` | MEP engineer | Own root, one supply duct Zuluft 1 through Wand 2, box mesh |
| 2 catalog | `2-catalog-generic.ifcx` | classification | Generic types G-SB-EXT, G-SB-INT, G-BALC, G-BALC-TB, and `refines` on D012 v2 and v3 |
| 2 catalog | `2-catalog-fab.ifcx` | fabricator | Variant D012-v3-F2, refining D012/v3 |
| 3 derivation | `3-derivation-federated.ifcx` | detail finder | One place across disciplines: Wand 2 and Zuluft 1 |
| 5 view | `5-view-cost-vp.ifcx` | cost planner | VP: one scope item for the exterior slab bearings |
| 5 view | `5-view-detail-v1.ifcx`, `5-view-cost-v1.ifcx` | detail editor, cost planner | The two views on the v1 places, written by hand |
| 5 view | `5-view-detail-bp.ifcx`, `5-view-cost-bp.ifcx` | detail editor, cost planner (carry step) | BP, on the v2 places: the v1 views carried by `4-lineage-v1-v2.ifcx`, plus one new detail statement (Wand 4) |
| 3 derivation | `3-derivation-v2-samename.ifcx` | detail finder | The places of v2-samename |
| 5 view | `5-view-detail-v2-samename-auto.ifcx` | detail editor (carry step) | v1 detail view carried by the ifc-lite lineage alone |
| 5 view | `5-view-detail-v2-samename.ifcx` | detail editor (carry step) | The same with the manual lineage entry |
| 6 provenance | `6-lineage-vp-bp.ifcx` | cost planner | Phase lineage: the VP scope item split into the BP cost items |
| 6 provenance | `6-lineage-type-d012.ifcx` | detail catalog | Type lineage: D012 v3 replaces v2 |
| (not a layer) | `ifc-lite/model-*.ifc` | `generate.py` | IFC STEP twins of the three models, for ifc-lite |
| (not a layer) | `ifc-lite/lineage-v1-*.json` | ifc-lite 0.45.1 | Lineage sidecars from diffing the twins |
| (not a layer) | `ifc-lite/lineage-corpus-r09-r10.json` | ifc-lite 0.45.1 | Lineage sidecar of a real corpus pair, see the last section |

Model v2 is a full re-export, not a layer on top of v1. That is the hard case:
new paths for every changed element. The rows from `0-federation-bp.ifcx` on
belong to "Views and phases" below.

`generate.py` writes all twenty-seven `.ifcx` files and the three STEP twins, and
copies the two lineage sidecars it read into the output folder. Everything
except the STEP twins is written last, after every check has passed. To
change the example, edit the script and run it in this folder (Python 3.8 or
later, no packages):

```sh
python3 generate.py
```

It writes next to itself and is deterministic, so an unchanged script gives
the committed files byte for byte. (proven by running: `python3 generate.py
<empty folder>` and `cmp` of every file) If a change touches an element's GlobalId,
name, class, box or `IsExternal`, the element order, or `DATE`, the STEP twins
change too and the script stops until the lineage sidecars are rerun (Node 20
or later). Colours and the storey name do not reach the twins (pointed at
`generate.py:204`, `step_model`, and the fixed storey name at
`generate.py:225`):

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
(proven by running, same test)

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

With that one attribute put back, the whole composed tree is the same in both
orders, orphan roots included. (proven by running:
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
the hashes in all three lineage layers and in the derivations of v1, v2 and
v2-samename, and compares the entries with the sidecars, turning each
GlobalId into its path with uuid5 and requiring that path to be a node of the
model)

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
containment, property set names and products other than walls and slabs are
not compared either. (unproven)

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
carried in this shape (pointed at `generate.py:638`; unproven, these layers
have no such case). The view shape has one, see "Carrying views across a
model revision".

Every other relation uses `copy-to-all`: every successor gets the type. Only
an `identity` successor keeps its state, unless the approval rule resets it;
any other successor is `to-confirm` (pointed at `generate.py:619`; `replaced`
is unproven, the example has none).

### Pieces keep the old name

In `v2-samename` both Wand 1 pieces are named "Wand 1". ifc-lite does not
report the split (proven by running: `npx -y @ifc-lite/cli@0.45.1 diff
model-v1.ifc model-v2-samename.ifc --geometry --split-merge --json` in
`ifc-lite/`):

- content matches: Wand 2 `renamed`, Wand 4 `moved`, and Wand 1 to the larger
  piece (`2WandW1aNeuTeilstueckA`, also named "Wand 1") `reshaped`, so the
  lineage says `identity`, `content-match:reshaped`, from Wand 1 to that piece
  only;
- split/merge claims: the balcony merge only;
- the smaller piece (`2WandW1bNeuTeilstueckB`) is in no lineage entry, so it
  would get no data.

This matches the edge case noted in the WP9 identity demo. The human-confirmed
path: `4-lineage-v1-v2-samename-manual.ifcx` is a separate layer, written by
the planner, with one entry Wand 1 to both pieces, `relation: "split"`,
`source: "manual"`, `author` and `timestamp`, and no shares. The ifc-lite
layer stays as it was produced. (proven by running, test named below)

Both lineage nodes compose side by side; IFCX cannot drop one entry from
another layer's `entries` list. The rule that a manual entry replaces every
ifc-lite entry naming one of its elements is a convention. `generate.py`
applies it (`effective`) when it carries the detail view to v2-samename, and
the test applies it again (`EffectiveLineage` in
`src/test/example-file-test.ts`). `generate.py` checks the manual entry by
the same rules as a sidecar entry (`check_entries`) and stops if it fails
one. (proven by running by hand: with the floor slab as a successor it exits
with "head is not an element with an occurrence in v2-samename") With the
convention, every
element new in v2-samename has a predecessor; without it, the smaller piece
(`2WandW1bNeuTeilstueckB`) has none.
(proven by running: `timber junction: ifc-lite misses a split whose pieces
keep the old name, a manual entry states it`) `4-assignment-*` is not
carried for v2-samename; the detail view is, see "Carrying views across a
model revision".

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
edits. (proven by running, same test) A split on an occurrence whose path survives (like Wand 3) would stay
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
overwrite an existing output file (pointed at `src/ifcx-cli/ifcx-cli.ts:84`).

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
`build-viewer` esbuild command) loaded the seven-layer v2 stack without an
error. Its model tree listed the model elements, the catalog and every
occurrence and orphan root of the v2 listing above, and a pixel count of the
canvas found opaque and translucent pixels. (proven by running once by hand,
not by a test: repo root served over HTTP, `web/viewer/index.html` opened in
a browser, the seven files passed in stack order to `addModel` of
`render.mjs`; nobody looked at the picture)

## Views and phases

The files above answer one question per place: which detail type goes here.
The files in this section add three axes around the same place:

- **who**: which discipline wrote an element. Each discipline has its own
  model layer. A federation manifest names the models of one phase.
- **view**: which discipline types the place: detail and cost here
  (physics, structure and fabrication would work the same way). A view never
  writes on the place. It writes its own node for each place it types.
- **time**: which phase: VP (Vorprojekt), BP (Bauprojekt), AP. Each phase has
  its own layer stack. A coarse item of an early phase is refined into finer
  items of a later one, recorded as lineage.

### Node shapes

```
place            uuid5(ns, "occurrence|<kind>|" + sorted member paths)
                 members, topology, derivation record; nothing else
view occurrence  uuid5(ns, "view|<view>|<place>")
                 inherits {place: <place>, type: <type>}
                 dokwood::assignment {view, state} and dokwood::<view>::*
scope item       uuid5(ns, "view|<view>|scope|<key>")
                 inherits {type: <type>}, dokwood::scope, dokwood::<view>::*
type level       inherits {refines: <the more generic type>}, own attribute id
```

Composed, a view occurrence shows the place's members, extent and derivation
record, the attributes of every level of its type, and its own data. Places
are the BP places of `3-derivation-v2.ifcx` plus one new place across
disciplines: Wand 2 penetrated by the duct Zuluft 1 of `1-model-mep.ifcx`.

The rules are conventions. IFCX checks none of them; `npm test` does:

1. **A place carries derivation data only.** `inherits` is transitive, so a
   type on the place shows on every view occurrence of it. With a throwaway
   layer (not committed) that puts D021/v1 on the Wand 1.1 place, the cost
   occurrence of Wand 1.1 composes with `dokwood::detail::type` D021/v1, a
   detail type nobody in the cost view chose. (proven by running: `timber
   junction views: a type written on the place leaks into every view, so the
   place holds no opinions`)
2. **A view writes only its group node and its own paths.** Then "at most one
   type per place and view" is a path collision, decided by layer order inside
   the view. No path is written by two view layers or by a view layer and any
   other layer of the BP stack, so the order of views does not matter: the BP
   stack with the detail and cost layers swapped composes to the same tree.
   The detail view types the exterior bearings D012/v3, the cost view types
   the same places G-SB-EXT, and neither carries the other's attributes.
   (proven by running: `timber junction views: each view types a place on its
   own node, and swapping view layers changes nothing`)
3. **A view occurrence inherits exactly `place` and `type`**, a scope item
   only `type`, a carried merge without an agreed type only `place`. (proven
   by running, same test, read from the input files of all five stacks with
   view layers)
4. **Each type level writes its own attribute id.** Composition drops the
   `inherits` edges, so these attributes are the only trace of the chain.
   (proven by running: `timber junction type chain: generic, D012/v3 and the
   fabrication variant compose and validate`; pointed at
   `src/ifcx-cli/ifcx-cli.ts:135`, which writes node, children and attributes)
5. **A scope item and its refinements are never in one stack**, or the length
   would count twice. (unproven)

The penetration place has no view occurrence: the catalog has no type for
penetrations. It is the only BP place the detail view does not type; the
cost view also leaves out Wand 4. (proven by running, views test of rule 2)

### Federation

`0-federation-bp.ifcx` has no data. It imports `1-model-v2.ifcx` and
`1-model-mep.ifcx`, each with `integrity`, the SHA-256 of the file in the
form `sha256-<base64>`. The derivation record of the federated place names
the manifest as `sourceLayer`, with its SHA-256, and through it both models.
The test compares every `integrity` with the file bytes and finds one member
of the place in each model. IFCX does not compare: with the manifest as the
only entry layer, its imports bring in both models, and a manifest with
`integrity: "sha256-AAAA"` composes to the same tree. (proven by running:
`timber junction federation: the place spans two discipline models bound by
the manifest`)

The MEP model has its own root node. On the architect's storey path its
storey name would replace the architect's, see gap 13.

### Type chain and revision

Two different facts, two mechanisms:

- **Specialization** (is-a, stays true): D012 is a generic exterior slab
  bearing, and the fabrication variant D012-v3-F2 is a D012/v3. Each is an
  `inherits.refines` on the more specific type. The composed variant shows
  `dokwood::type::generic`, `dokwood::detail::type` and
  `dokwood::fab::variant`. Every node is validated before `inherits` is
  expanded, so a wrong value at the generic level fails the whole BP stack.
  (proven by running, type chain test)
- **Revision** (replaces): D012 v3 replaces v2. v3 is no v2, and inheriting
  would copy v2's attributes onto v3 (pointed at
  `src/ifcx-core/composition/compose.ts:156`). So it is a lineage entry,
  `axis: "type"`, `relation: "replaced"`, in `6-lineage-type-d012.ifcx`.
  (proven by running, type chain test)

`2-catalog-generic.ifcx` writes the `refines` edge on the D012 nodes of
`2-catalog.ifcx`, because `2-catalog.ifcx` stays as it is. In a real catalog
the edge would sit in the catalog itself. One effect: in the VP stack, which
has no detail catalog, the two D012 paths compose as root nodes that carry
only the generic type. (proven by running: VP compose below)

### Phases

`6-lineage-vp-bp.ifcx` holds one entry with `axis: "phase"`: the VP scope
item (exterior slab bearings, 12.5 m estimated) is split into the three BP
cost items of Wand 1.1, Wand 1.2 and Wand 2, with shares by derived length,
4/12, 2/12 and 6/12. `base` and `head` hold the SHA-256 of
`5-view-cost-vp.ifcx` and `5-view-cost-bp.ifcx` and the phase. The test
derives the successors again from model v2 (every exterior slab-on-wall
place), and checks the shares, their sum and both hashes. (proven by running:
`timber junction phases: the VP scope item is split into the BP cost items by
length`) The BP cost view also has items for Wand 3 and the balcony, which
the scope item does not cover.

The scope item is `approved` and has no `reviewedSha256`. It has no place and
no derivation record, so its approval is bound to nothing, and the approval
rule is not checked on the VP stack: there is nothing to compare with, see
gap 25. (proven by running, type chain test; pointed at
`5-view-cost-vp.ifcx`)

`dokwood::lineage` gets a field `axis` (`version`, `phase`, `type`) and an
optional `phase` in `base` and `head`. The new layers declare that schema
under the same id. A schema id has one declaration per stack, the last one
(gap 12), so `axis` is optional and absent means `version`: the existing
lineage layers stay unchanged and `4-lineage-v1-v2.ifcx` with
`6-lineage-vp-bp.ifcx` composes in either order. With `axis` required in a
copy of the new layer, the order with that declaration last fails on the old
layer's data. (both proven by running, same test) The price is that the id
has two declarations in the BP stack and the order decides what is checked,
see gap 12.

### Continuity

Inside BP the place links the views: the detail and the cost occurrence of
Wand 1.1 inherit the same place. From VP to BP, the phase lineage leads from
the scope item to the cost items, and through their places to the detail
occurrences. Along types, the VP scope item, the BP cost items of Wand 1.1,
Wand 1.2 and Wand 2, the detail occurrences of the same three places and the
variant all show `dokwood::type::generic` G-SB-EXT. The cost item of Wand 3
shows G-SB-INT and the balcony's has no generic type. (proven by running:
views and type chain tests) A place path
depends on its member paths, so it is stable within one model version only;
across versions, places follow element lineage as in the sections above.

The example has two shapes side by side: the single-view shape of the v1
and v2 stacks (`inherits.detailType` on the place, `4-assignment-*`) and the
view shape. `4-assignment-*` and `4-manual-split` stay out of the view
stacks, since they write on the places (rule 1). The detail view says the
same as `4-assignment-*`, in v1 and after the carry. (proven by running,
carry test below)

### Carrying views across a model revision

A view occurrence path is `uuid5(view|place)` and a place path depends on
its member paths. So when the model is exported again, a view occurrence
keeps its path only where every member kept its GlobalId (Wand 3). All
others would be orphaned. They survive because a carry step writes them
again on the new places, from three inputs: the views on the v1 places
(`5-view-detail-v1.ifcx`, `5-view-cost-v1.ifcx`), the element lineage
(`4-lineage-v1-v2.ifcx`) and the places derived from v2.

The carry step is `carry` in `generate.py`, the same function that writes
`4-assignment-v2.ifcx`: `4-assignment-v2.ifcx` is byte for byte what it was
before the function was shared. (proven by running: `generate.py` into an
empty folder and `diff -rq`) It runs once per view. `5-view-detail-bp.ifcx`
and `5-view-cost-bp.ifcx` are its output, so the BP stack has one set of
view layers. A statement that is new in BP sits in the same layer without
`carriedFrom`; there is one, D021/v1 `proposed` for Wand 4.

Each carried occurrence says where it came from, in `carriedFrom` of
`dokwood::assignment`: `layer` and `sha256` of the v1 view layer, the v1
`occurrences`, the element `lineage` node, `relation` and `policy`. Where the
place path is unchanged there is no `lineage`. It is a field and not a
lineage layer of its own: the lineage stays a fact about elements, stated
once, and the carry is what follows from it.

| Case | Place | Detail view | Cost view |
|---|---|---|---|
| split | Wand 1 to Wand 1.1, Wand 1.2 | both D012/v3 `to-confirm` | both G-SB-EXT `to-confirm`, 175 CHF/m |
| identity, new GlobalId | Wand 2 | D012/v3 `in-review`, kept | G-SB-EXT, `approved` to `to-confirm`, 168 CHF/m |
| same path | Wand 3 | D021/v1, `approved` to `to-confirm` | G-SB-INT `in-review`, kept, 95 CHF/m |
| merge | Balkonplatte A, B to Balkonplatte | both D031/v1: D031/v1 `to-confirm` | G-BALC and G-BALC-TB: no type, no cost line, `to-confirm` |
| new in BP | Wand 4 | D021/v1 `proposed`, not carried | none |

(proven by running: `timber junction views carry: the v1 views arrive on the
v2 places by element lineage, each view on its own`. It compares the
composed rows, then checks every carried occurrence against the v1 view, the
lineage entry that leads to its place and the derivation hash, and finds no
v1 occurrence without a successor.)

- **State.** A state is kept on an identity or an unchanged path, except an
  approval whose `reviewedSha256` no longer matches. Every v2 derivation
  record names model v2, so no v1 approval survives this revision, on any
  place. Wand 2 shows the views apart: the cost view had approved it and
  drops to `to-confirm`, the detail view keeps `in-review`. (proven by
  running: `timber junction views carry: an approval holds only for the
  derivation it reviewed, per view`) An approval that survives because the
  place's own inputs did not change would need a hash over less than the
  whole model file. (unproven, not built)
- **View data.** The cost line travels with its occurrence: copied to every
  successor of a split or identity, and on a merge only if all predecessors
  have the same. A price per metre can be copied; a lump sum would have to
  be divided by `shares`. (copy and the differing merge proven by running,
  carry test; a merge with equal cost lines and a lump sum are unproven, the
  example has neither)
- **Merge with different types.** One occurrence with `carriedFrom` naming
  both predecessors, `inherits` only `place`, `to-confirm`. The person
  confirming sees what was there. (proven by running, carry test)
- **Pieces keep the old name.** `5-view-detail-v2-samename-auto.ifcx` is the
  carry with the ifc-lite lineage alone: the larger Wand 1 piece is carried
  as `identity`, the place of the smaller piece gets no occurrence. That
  stack composes and passes every carry rule. Only a count of places
  without an occurrence shows it, and it cannot tell this from a place
  nobody typed yet (Wand 4). `5-view-detail-v2-samename.ifcx` is the carry
  with the manual entry in place of the ifc-lite one: both pieces
  `to-confirm`, `relation: "split"`, `lineage` naming the manual node.
  (proven by running: `timber junction views carry: with the ifc-lite
  lineage alone the smaller Wand 1 piece gets nothing, the manual entry
  fixes it`)
- **A place that is gone.** The carry step stops when a v1 occurrence has
  neither its path nor a lineage entry. (proven by running: `generate.py`
  with the balcony merge entry removed exits with "the place of ['BA',
  'BB'] is gone") A view occurrence that is in a stack without its place
  composes without error. A check on the input files finds it: every
  `inherits.place` must be a node with a derivation record in the stack.
  With the v1 view layers left in the BP stack it finds the eight v1
  occurrences on places that were not derived again, and each is named in a
  `carriedFrom`. A hand-made occurrence on a place nothing names is found
  the same way and is named by nothing. The example models have no place
  that goes without lineage, so that occurrence is a throwaway layer in the
  test. (proven by running: `timber junction views: a view occurrence whose
  place is gone composes without error, a check on the files finds it`)

Not carried: the manual split (gap 5) and the federated place, which has no
view occurrence and no v1.

### Stack order

Federation, models, catalogs, places, views, lineage. Inside one view, oldest
first.

| VP | v1 views | BP | v2-samename views |
|---|---|---|---|
| `2-catalog-generic` | `1-model-v1` | `0-federation-bp` | `1-model-v2-samename` |
| `5-view-cost-vp` | `2-catalog-generic` | `1-model-v2` (architecture) | `2-catalog-generic` |
| | `2-catalog` | `1-model-mep` | `2-catalog` |
| | `3-derivation-v1` | `2-catalog-generic` | `3-derivation-v2-samename` |
| | `5-view-detail-v1` | `2-catalog` | `5-view-detail-v2-samename` |
| | `5-view-cost-v1` | `2-catalog-fab` | `4-lineage-v1-v2-samename` |
| | | `3-derivation-v2` | `4-lineage-v1-v2-samename-manual` |
| | | `3-derivation-federated` | |
| | | `5-view-detail-bp` | |
| | | `5-view-cost-bp` | |
| | | `4-lineage-v1-v2` | |
| | | `6-lineage-vp-bp` | |
| | | `6-lineage-type-d012` | |

"v1 views" is the BP work one model revision earlier. The BP stack holds
`4-lineage-v1-v2`, which its carried occurrences name. The fifth stack,
"v2-samename views, auto", has `5-view-detail-v2-samename-auto` and no
manual lineage layer.

A real VP stack would start with a VP architecture model. The scope item does
not need one, so the example leaves it out. In the BP stack the manifest's
imports are already listed, so it adds no layer (pointed at
`src/ifcx-core/layers/layer-stack.ts:92`).

After the block in "Compose it", with the same `$out`:

```sh
node ../../src/ifcx-cli.js compose 2-catalog-generic.ifcx 5-view-cost-vp.ifcx "$out/vp.json"
node ../../src/ifcx-cli.js compose 1-model-v1.ifcx 2-catalog-generic.ifcx 2-catalog.ifcx 3-derivation-v1.ifcx 5-view-detail-v1.ifcx 5-view-cost-v1.ifcx "$out/v1-views.json"
node ../../src/ifcx-cli.js compose 0-federation-bp.ifcx 1-model-v2.ifcx 1-model-mep.ifcx 2-catalog-generic.ifcx 2-catalog.ifcx 2-catalog-fab.ifcx 3-derivation-v2.ifcx 3-derivation-federated.ifcx 5-view-detail-bp.ifcx 5-view-cost-bp.ifcx 4-lineage-v1-v2.ifcx 6-lineage-vp-bp.ifcx 6-lineage-type-d012.ifcx "$out/bp.json"
node ../../src/ifcx-cli.js compose 1-model-v2-samename.ifcx 2-catalog-generic.ifcx 2-catalog.ifcx 3-derivation-v2-samename.ifcx 5-view-detail-v2-samename.ifcx 4-lineage-v1-v2-samename.ifcx 4-lineage-v1-v2-samename-manual.ifcx "$out/samename-views.json"
node ../../src/ifcx-cli.js compose 1-model-v2-samename.ifcx 2-catalog-generic.ifcx 2-catalog.ifcx 3-derivation-v2-samename.ifcx 5-view-detail-v2-samename-auto.ifcx 4-lineage-v1-v2-samename.ifcx "$out/samename-views-auto.json"
```

All five exit 0 with validation and fetch on. Composed nodes below the root,
and root nodes: VP 9 and 4, v1 views 47 and 6, BP 58 and 12, v2-samename
views 43 and 7, auto 41 and 6. (proven by running)

The web viewer, built with the `build-viewer` esbuild command into a scratch
folder, loaded the BP stack as it was before the carry (twelve layers,
hand-written view layers) and rendered the walls, the slab and the duct
through Wand 2, which has a box mesh; the model tree listed both view groups.
(proven by running before the carry step was added, headless Chrome) Not
rerun for the stacks above. (unproven)

## Open gaps

1. **Orphaned opinions after re-derivation.** `4-assignment-v1.ifcx` still
   speaks about the v1 occurrences of Wand 1, Wand 2 and the two balcony
   pieces, and `4-manual-split.ifcx` about Wand 2. Nothing derives those paths
   any more, so composition turns each into a new root node with a type, a
   state, or a split, but no members. IFCX has no rule to flag or drop such a
   node, and a later layer cannot delete a node. (proven by running; root
   detection at `src/ifcx-core/composition/cycles.ts:50`) Nulling the
   orphan's `inherits` entry and its `dokwood::detail::assignment` attribute
   composes and validates. The type is gone, the assignment attribute stays
   as a key with value null, and the root and its split stay. (proven by running: `timber junction manual split of the Wand 2
   occurrence is orphaned when Wand 2 is re-derived`)
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
   `1-model-v1.ifcx`, `2-catalog.ifcx`, `3-derivation-v2.ifcx` and
   `4-assignment-v2.ifcx` compose with exit 0. (proven by running) `children`
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

Found with "Views and phases":

8. **Two inherited types writing one attribute: one wins without notice.**
   The winner follows the order in which each `inherits` key was first
   inserted across all layers, not layer order: setting the first key again
   in the last layer does not make it win. (proven by running, with
   throwaway layers not in this repo; pointed at
   `src/ifcx-core/composition/compose.ts:40` and `:143`) In this example the
   leak test is such a case: the Wand 1.1 detail occurrence inherits
   `dokwood::detail::type` from its place and from its type and keeps its
   own, without error. (proven by running)
9. **Composed output drops `inherits`.** Which type a view gave a place
   survives only as attribute content. (proven by running: the composed BP
   stack has no `inherits`; pointed at `src/ifcx-cli/ifcx-cli.ts:135` and
   `src/ifcx-core/composition/node.ts:19`)
10. **No rules on nodes.** "Exactly `place` and `type`" cannot be declared;
    validation covers attribute values only. (pointed at
    `src/ifcx-core/schema/schema-validation.ts:124` and `schema/ifcx.tsp:17`)
11. **`inherits` to a missing path composes.** A view occurrence whose place
    is gone composes without error and shows only its type and its own
    data. (proven by running: `timber junction views: a view occurrence
    whose place is gone composes without error, a check on the files finds
    it`)
12. **A schema id has one declaration per stack, the last.** Two layers that
    declare the same id differently: the first layer's data is validated
    against the second declaration and fails. (proven by running, with
    throwaway layers; pointed at `src/ifcx-core/workflows.ts:169`) This
    example has the case: the `4-lineage-*` layers declare `dokwood::lineage`
    without `axis` and `phase`, the `6-lineage-*` layers with them. Keys a
    declaration does not name are not checked, so which fields are validated
    depends on the layer order: with the old declaration last, an `axis` of
    `"sideways"` composes; with the new one last, as in the BP stack, it
    fails. (proven by running: phases test) One declaration for all lineage
    layers would change the three `4-lineage-*` files and is left for later.
13. **No path ownership.** Two models that write the same storey path: the
    children are merged and the later layer's name wins. (proven by running,
    with throwaway layers) The MEP model here avoids it with its own root.
14. **Import `integrity` is not checked**, so the federation manifest binds
    nothing until it is. (proven by running: federation test; pointed at
    `src/ifcx-core/layers/fetch-layer-provider.ts:39`) `schema/ifcx.tsp:82`
    only declares the field. (unproven that the spec says what a mismatch
    does)
15. **Imported layers are placed after the importer.** A view layer that
    imported its derivation would end up below it in the stack. Here no view
    layer imports another. (pointed at
    `src/ifcx-core/layers/layer-stack.ts:105`; not run)
16. **The header has no writer role, view or phase.** A view layer is known
    by its file name only. (pointed at `schema/ifcx.tsp:21`)
17. **No selector reference.** A scope such as "all exterior slab bearings"
    is text in `dokwood::scope`. (unproven that no construct exists; none in
    `schema/ifcx.tsp`)
18. **`inherits` is transitive**, so an opinion on a place reaches every view
    occurrence of it. Handled by rule 1 of "Views and phases", not an IFCX
    change.
19. **Lineage needs an axis** (version, phase, type). The shape composes and
    validates. (proven by running: phases test) Belongs to the `bsi::lineage`
    proposal below.

Found with "Carrying views across a model revision":

20. **A view occurrence does not survive a re-export by itself.** Its path
    follows the place path, which follows the GlobalIds. Without the carry
    step it is orphaned, and gap 11 hides that. (proven by running: orphan
    test, v1 view layers in the BP stack)
21. **A wrong lineage carries wrongly and validates.** The carry by the
    ifc-lite lineage alone passes every rule the tests have. A place left
    without an occurrence looks like a place not typed yet. (proven by
    running: samename carry test)
22. **An approval is bound to the whole model file.** The derivation record
    holds the model's SHA-256, so every re-export makes every approval stale,
    also on places whose members did not change. (proven by running: views
    approval test, no approval left in BP)
23. **`carriedFrom` is not checked by IFCX.** Its `occurrences`, `lineage`,
    `layer` and `sha256` are strings; the v1 view layers they name are not in
    the BP stack. The test checks them against the files. (proven by
    running, carry test)
24. **The carry is a tool outside IFCX**, as in gap 5, now once per view. It
    has to run after every re-export and before anyone reads the views.
    Nothing in a stack says whether it ran. (pointed at `generate.py:594`,
    `carry`)

Found in code review:

25. **A scope item's approval is bound to nothing.** The VP scope item is
    `approved` without `reviewedSha256`: it has no place, so there is no
    derivation record to hash. The approval rule covers places only, and no
    test checks it on the VP stack. What a scope approval should name (the
    floor plan it was estimated from, say) is open. (pointed at
    `5-view-cost-vp.ifcx`; that it composes so is proven by running, type
    chain test)

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
and the geometry split check decides. (proven by running: names read from the
two files, `duplicated` and the split from `--json`) The sidecar is not translated into an
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
  layer order. (unproven) With an axis: version, phase or type.
- A review binding: an opinion that names the hash of the record it judged,
  and a rule that it lapses when that record changes.
- A composition rule for opinions about nodes that no longer exist.

The detail types and their catalog stay in a domain namespace; they are not a
buildingSMART concern.
