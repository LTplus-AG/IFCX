# Boolean-output identity (the hard part)

> Settles open question 1 of the geometry-tiers rework "on paper" before code.
> Companion to [geometry-tiers-rework-plan.md](geometry-tiers-rework-plan.md).

## The problem

Once topology is addressed by **path** instead of ordinal index
(`<../Edge_3>`, not `faces[3]`), every authored primitive needs a stable
identity to be the target of a path. Authored input geometry can carry that
identity (a preserved UUID, or a content-derived key). A **face produced by a
boolean** has no pre-existing identity — the kernel invented it. So: what path
segment does a boolean-output face get, and is that path stable enough to
reference across edits / kernels / sessions?

This is the one genuinely hard sub-problem in the rework. Everything else is
mechanical once the children model is fixed; this is not.

## What we actually generate today (scope check)

The branch does **not** currently emit boolean-output *Brep topology*:

- `BooleanResult` (Tier P / procedural) is tessellated straight to a **mesh**
  via BSP mesh CSG (`csg.ts`). The output is triangles, not faces with
  identity. There is no Brep-level boolean kernel.
- Imported Breps (AP242, `manifold_solid_brep`) are **already evaluated** by
  the source kernel. Their faces have whatever identity the source assigned;
  no boolean runs on our side.

So "boolean-output face identity" is a **forward-looking** question for IFCX.
It does not block the children rework — but the model must not paint us into a
corner, and the group will ask, so we state a position now.

## The three options (from the rework brief)

- **(a) deterministic geometric hash of the resulting face** — name a face by a
  canonical hash of its resolved geometry (surface params + loop vertices,
  rounded to tolerance).
- **(b) provenance reference back to the contributing input faces** — each
  output face records which input face(s) it descends from.
- **(c) declare derived topology non-persistent** — output faces get no
  durable identity; annotations on them must be re-applied after any re-eval.

## Recommended position: (b) as the mechanism, deterministic naming for within-kernel stability, (c) as the honesty boundary

A layered answer rather than picking one:

### 1. Provenance is the durable link — (b)

Every derived face carries a **cache-only** provenance attribute:

```jsonc
// on a boolean-output face node, e.g. result/Face_k
{
  "bsi::ifc::geometry::brep::derived_from": {
    "operation": "difference",
    "sources": ["<wall/Body/Face_2>", "<opening/Body/Face_5>"]
  }
}
```

`sources` are **paths to authored input faces** (resolved against the
post-composition tree). This is the property worth keeping: it lets a consumer
trace a result face back to faces that *do* have stable identity, and
re-propagate annotations (materials, finishes, classifications) along the
provenance edge after a re-evaluation — even when the result face's own name
changed. Provenance is cache-only because it is recomputed whenever the boolean
is re-evaluated; it has no identity of its own to reference.

### 2. Naming is deterministic and provenance-derived — narrow (a)

Output face names are a pure function of the inputs, not a fresh counter:

- A face carried through a boolean **unchanged** keeps its source name
  (`Face_<sourceName>`).
- A face **created or split** by the cut is named from its contributing input
  faces plus a local disambiguator, e.g.
  `Face_<srcA>__x__<srcB>_0`, `…_1`, ordered by a canonical geometric sort
  (centroid lexicographic) so the disambiguator is reproducible.

This gives the achievable guarantee: **re-running the same kernel at the same
tolerance on the same input reproduces the same names.** We deliberately do
*not* adopt pure geometric hashing (full (a)) as the primary key — a hash is
maximally brittle (any tolerance/units nudge changes every name) and carries no
human or relational meaning. Geometry only enters as the tie-break sort.

### 3. The honesty boundary is cross-kernel — (c), scoped

We state plainly in the design doc:

> Derived-topology identity is **best-effort and kernel-dependent**. Names are
> stable across re-evaluations of the *same* kernel at the *same* tolerance.
> They are **not** guaranteed stable across different kernels, tolerances, or
> major kernel versions. Annotations attached directly to a derived face may
> need re-application after a cross-kernel re-eval; annotations attached to
> input faces and propagated via `derived_from` survive it.

This is the (c) concession, but scoped to where it is actually unavoidable
(crossing kernels) instead of conceding all persistence.

## Why this is the right call for the group

- It concedes the persistent-naming point honestly (Thomas's original
  objection) without overclaiming a guarantee no kernel can make.
- It keeps the **federation story intact**: annotate the durable input faces,
  let provenance carry the opinion onto derived faces. That is the same
  layering argument the whole rework rests on.
- It costs nothing now: until there is a Brep-level boolean kernel, the only
  derived faces we emit come from imports (which inherit source identity), so
  `derived_from` is simply unused until it is needed. The schema slot exists;
  the behaviour lights up when a Brep boolean lands.

## The one thing to confirm with Thomas

Is **provenance-back-to-input-faces (b)** an acceptable contract for the group,
or does the group prefer derived topology be treated as flatly
**non-persistent (c)** with mandatory re-annotation? We lean (b)+(c-scoped) as
above; this is the gating question for whether the `derived_from` slot is part
of the spec or just an internal hint.
