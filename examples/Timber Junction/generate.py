"""Generate the .ifcx files of the Timber Junction example.

Run from anywhere with Python 3.8 or later, no packages needed:

    python3 generate.py [output-folder]

Without an argument the files are written next to this script, replacing the
committed ones. The output is deterministic: running it on an unchanged script
gives the committed files byte for byte.
"""
import hashlib, json, sys, uuid
from pathlib import Path

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
NS = uuid.uuid5(uuid.NAMESPACE_URL, "dokwood.example/timber-junction")
ID_PREFIX = "ifc5.technical.buildingsmart.org/examples/Timber Junction/"
DATE = "2026-11-13"


def u(*parts):
    return str(uuid.uuid5(NS, "|".join(parts)))


def path_of(gid):
    return u("element", gid)


def header(name, author):
    return {"id": ID_PREFIX + name, "ifcxVersion": "ifcx_alpha", "dataVersion": "1.0.0",
            "author": author, "timestamp": DATE}


def write(f):
    p = OUT / f["header"]["id"][len(ID_PREFIX):]
    p.write_text(json.dumps(f, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return hashlib.sha256(p.read_bytes()).hexdigest()


# key, GlobalId (from wp9-identity-demo), name, x0, y0, length, thickness, external
WALL_HEIGHT = 2.6
WALLS_V1 = [
    ("W1", "1WandW1altAussenwand01", "Wand 1", 0.0, 0.0, 6.0, 0.24, True),
    ("W2", "1WandW2altAussenwand02", "Wand 2", 0.0, 5.0, 6.0, 0.24, True),
    ("W3", "1WandW3InnenwandStabil", "Wand 3", 0.0, 2.5, 3.0, 0.12, False),
    ("W4", "1WandW4altInnenwand004", "Wand 4", 3.5, 2.5, 2.5, 0.12, False),
]
WALLS_V2 = [
    ("W1a", "2WandW1aNeuTeilstueckA", "Wand 1.1", 0.0, 0.0, 4.0, 0.24, True),
    ("W1b", "2WandW1bNeuTeilstueckB", "Wand 1.2", 4.0, 0.0, 2.0, 0.24, True),
    ("W2neu", "2WandW2NeuNurNeueGuid2", "Wand 2", 0.0, 5.0, 6.0, 0.24, True),
    WALLS_V1[2],
    ("W4neu", "2WandW4NeuVerschoben04", "Wand 4", 3.5, 3.0, 2.5, 0.12, False),
]
SLAB_GID = "1DeckeUeberEGStabil001"
SLAB_P = path_of(SLAB_GID)
SLAB_NAME = "Decke über EG"
SLAB_BOX = (0.0, 0.0, WALL_HEIGHT, 6.0, 5.24, WALL_HEIGHT + 0.24)

STOREY = u("storey")
CATALOG = u("catalog")
OCC_GROUP = u("detail-occurrences")




def slug(name):
    return name.replace(" ", "_").replace(".", "_")


def ifc_class(code):
    return {"code": code, "uri": "https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/" + code}


def box_mesh(x0, y0, z0, x1, y1, z1):
    pts = [[x, y, z] for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
    # quads as (a, b, c, d) over the corner indices above, wound outward
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    idx = []
    for a, b, c, d in quads:
        idx += [a, b, c, a, c, d]
    return {"points": pts, "faceVertexIndices": idx}


PROP_IMPORT = {"uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx"}
MODEL_IMPORTS = [
    {"uri": "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx"},
    PROP_IMPORT,
    {"uri": "https://ifcx.dev/@openusd.org/usd@v1.ifcx"},
]


def model(walls, version):
    data = []
    children = {}
    for _, gid, name, x0, y0, length, thick, ext in walls:
        p = path_of(gid)
        body = u("body", gid)
        children[slug(name)] = p
        data.append({"path": p, "children": {"Body": body}, "attributes": {
            "bsi::ifc::class": ifc_class("IfcWall"),
            "bsi::ifc::prop::Name": name,
            "bsi::ifc::prop::IsExternal": ext,
        }})
        data.append({"path": body, "attributes": {
            "usd::usdgeom::mesh": box_mesh(x0, y0, 0.0, x0 + length, y0 + thick, WALL_HEIGHT),
            "bsi::ifc::presentation::diffuseColor": [0.82, 0.68, 0.47] if ext else [0.9, 0.82, 0.66],
        }})
    sbody = u("body", SLAB_GID)
    children["Decke_ueber_EG"] = SLAB_P
    data.append({"path": SLAB_P, "children": {"Body": sbody}, "attributes": {
        "bsi::ifc::class": ifc_class("IfcSlab"),
        "bsi::ifc::prop::Name": SLAB_NAME,
    }})
    data.append({"path": sbody, "attributes": {
        "usd::usdgeom::mesh": box_mesh(*SLAB_BOX),
        "bsi::ifc::presentation::diffuseColor": [0.7, 0.7, 0.7],
        "bsi::ifc::presentation::opacity": 0.4,
    }})
    data.insert(0, {"path": STOREY, "children": children, "attributes": {
        "bsi::ifc::class": ifc_class("IfcBuildingStorey"),
        "bsi::ifc::prop::Name": "EG",
    }})
    return {"header": header(f"1-model-{version}.ifcx", "architect (authoring tool export)"),
            "imports": MODEL_IMPORTS, "schemas": {}, "data": data}


S_REF = {"dataType": "Reference"}
S_STR = {"dataType": "String"}
S_REAL = {"dataType": "Real"}


def obj(values, optional=()):
    vals = {}
    for k, v in values.items():
        vals[k] = dict(v, optional=True) if k in optional else v
    return {"dataType": "Object", "objectRestrictions": {"values": vals}}


def arr(v):
    return {"dataType": "Array", "arrayRestrictions": {"value": v}}


S_POINT = arr(S_REAL)


def enum(*opts):
    return {"dataType": "Enum", "enumRestrictions": {"options": list(opts)}}


# ---- catalog -------------------------------------------------------------
DETAIL_TYPES = {
    "D012": (["v2", "v3"], "Deckenauflager aussen", [("bearing", "AW Holzrahmen 240"), ("supported", "Decke Holz 240")]),
    "D021": (["v1"], "Innenwand unter Decke", [("bearing", "IW Holzrahmen 120"), ("supported", "Decke Holz 240")]),
}


def catalog():
    data = [{"path": CATALOG, "children": {code: u("type", code) for code in DETAIL_TYPES},
             "attributes": {"dokwood::catalog": {"name": "DOKwood Detailkatalog (example)",
                                                 "publisher": "DOKwood platform"}}}]
    for code, (vers, _, _) in DETAIL_TYPES.items():
        data.append({"path": u("type", code), "children": {v: u("type", code, v) for v in vers}})
    for code, (vers, name, roles) in DETAIL_TYPES.items():
        for ver in vers:
            data.append({"path": u("type", code, ver), "attributes": {"dokwood::detail::type": {
                "code": code, "name": name, "version": ver, "junction": "slab-on-wall",
                "roles": [{"role": r, "assembly": a} for r, a in roles],
                "document": f"https://example.org/dokwood/details/{code}_{ver}.pdf",
            }}})
    schemas = {
        "dokwood::catalog": {"value": obj({"name": S_STR, "publisher": S_STR})},
        "dokwood::detail::type": {"value": obj({
            "code": S_STR, "name": S_STR, "version": S_STR, "junction": S_STR,
            "roles": arr(obj({"role": S_STR, "assembly": S_STR})),
            "document": S_STR})},
    }
    return {"header": header("2-catalog.ifcx", "DOKwood platform (detail catalog)"),
            "imports": [], "schemas": schemas, "data": data}


# ---- derivation ----------------------------------------------------------
ENGINE = {"engine": "detail-finder", "engineVersion": "1.4.0", "tolerance": 0.001}


def occ_path(wall_path, slab_path):
    # Name is a pure function of the inputs: junction kind plus sorted member paths.
    return u("occurrence", "slab-on-wall", *sorted([wall_path, slab_path]))


def derivation(walls, version, model_sha):
    data, children = [], {}
    for _, gid, name, x0, y0, length, thick, ext in walls:
        wp = path_of(gid)
        op = occ_path(wp, SLAB_P)
        children[slug(name) + "__Decke"] = op
        yc = round(y0 + thick / 2, 4)
        data.append({"path": op, "attributes": {
            "dokwood::detail::members": [{"ref": wp, "role": "bearing"}, {"ref": SLAB_P, "role": "supported"}],
            "dokwood::detail::topology": {"junction": "slab-on-wall", "extent": {
                "kind": "line", "length": length,
                "start": [x0, yc, WALL_HEIGHT], "end": [x0 + length, yc, WALL_HEIGHT]}},
            "dokwood::derivation": dict(ENGINE, operation="junction-detection",
                                        sources=sorted([wp, SLAB_P]),
                                        sourceLayer=ID_PREFIX + f"1-model-{version}.ifcx",
                                        sourceSha256=model_sha),
        }})
    data.insert(0, {"path": OCC_GROUP, "children": children,
                    "attributes": {"bsi::ifc::prop::Name": "Detail occurrences (derived)"}})
    schemas = {
        "dokwood::detail::members": {"value": arr(obj({"ref": S_REF, "role": S_STR}))},
        "dokwood::detail::topology": {"value": obj({"junction": S_STR, "extent": obj({
            "kind": enum("point", "line", "area"), "length": S_REAL, "start": S_POINT, "end": S_POINT},
            optional=("length", "start", "end"))})},
        "dokwood::derivation": {"value": obj({
            "operation": S_STR, "engine": S_STR, "engineVersion": S_STR, "tolerance": S_REAL,
            "sources": arr(S_REF), "sourceLayer": S_STR, "sourceSha256": S_STR})},
    }
    return {"header": header(f"3-derivation-{version}.ifcx", "detail-finder 1.4.0 (derived, do not edit)"),
            "imports": [PROP_IMPORT], "schemas": schemas, "data": data}


# ---- assignment + lineage ------------------------------------------------
RELATIONS = ("split", "merge", "renamed", "moved", "replaced")
POLICIES = ("copy-to-all",)
ASSIGN_SCHEMA = {"dokwood::detail::assignment": {"value": obj({
    "state": enum("proposed", "in-review", "approved", "to-confirm"),
    "carriedFrom": obj({"occurrence": S_REF, "lineage": S_REF,
                        "relation": enum(*RELATIONS), "policy": enum(*POLICIES)}),
}, optional=("carriedFrom",))}}


def type_ref(code, ver):
    return f"{CATALOG}/{code}/{ver}"


W = {k: path_of(g) for k, g, *_ in WALLS_V1 + WALLS_V2}
OCC = {k: occ_path(p, SLAB_P) for k, p in W.items()}

ASSIGN_V1 = [("W1", "D012", "v3", "approved"), ("W2", "D012", "v3", "in-review"), ("W3", "D021", "v1", "approved")]


def assignment_v1():
    data = [{"path": OCC[k], "inherits": {"detailType": type_ref(c, v)},
             "attributes": {"dokwood::detail::assignment": {"state": s}}} for k, c, v, s in ASSIGN_V1]
    return {"header": header("4-assignment-v1.ifcx", "detail editor (DOKwood platform)"),
            "imports": [], "schemas": ASSIGN_SCHEMA, "data": data}


LINEAGE = u("lineage", "v1", "v2")
LINEAGE_ENTRIES = [
    (["W1"], ["W1a", "W1b"], "split", "split:verified", [0.6667, 0.3333]),
    (["W2"], ["W2neu"], "renamed", "content-match:renamed", None),
    (["W4"], ["W4neu"], "moved", "content-match:moved", None),
]


def lineage(sha1, sha2):
    entries = []
    for pre, suc, rel, ev, shares in LINEAGE_ENTRIES:
        e = {"predecessors": [W[k] for k in pre], "successors": [W[k] for k in suc],
             "relation": rel, "evidence": ev}
        if shares:
            e["shares"] = shares
        entries.append(e)
    data = [{"path": LINEAGE, "attributes": {"dokwood::lineage": {
        "producer": "@ifc-lite/diff lineage, transcribed",
        "base": {"layer": ID_PREFIX + "1-model-v1.ifcx", "sha256": sha1},
        "head": {"layer": ID_PREFIX + "1-model-v2.ifcx", "sha256": sha2},
        "entries": entries, "deleted": []}}}]
    model_ref = obj({"layer": S_STR, "sha256": S_STR})
    schemas = {"dokwood::lineage": {"value": obj({
        "producer": S_STR, "base": model_ref, "head": model_ref,
        "entries": arr(obj({"predecessors": arr(S_REF), "successors": arr(S_REF),
                            "relation": enum(*RELATIONS),
                            "evidence": S_STR, "shares": arr(S_REAL)}, optional=("shares",))),
        "deleted": arr(S_REF)})}}
    return {"header": header("4-lineage-v1-v2.ifcx", "model comparison (@ifc-lite/diff)"),
            "imports": [], "schemas": schemas, "data": data}


def assignment_v2():
    # copy-to-all: every successor of an assigned occurrence gets the type, but must be re-confirmed.
    data = []
    by_old = {k: (c, v, s) for k, c, v, s in ASSIGN_V1}
    for pre, suc, rel, _, _ in LINEAGE_ENTRIES:
        if len(pre) != 1:
            raise ValueError("only single-predecessor relations are carried")
        if pre[0] not in by_old:
            continue
        c, v, s = by_old[pre[0]]
        for k in suc:
            data.append({"path": OCC[k], "inherits": {"detailType": type_ref(c, v)},
                         "attributes": {"dokwood::detail::assignment": {
                             "state": "to-confirm" if rel == "split" else s,
                             "carriedFrom": {"occurrence": OCC[pre[0]], "lineage": LINEAGE,
                                             "relation": rel, "policy": "copy-to-all"}}}})
    return {"header": header("4-assignment-v2.ifcx", "detail editor (DOKwood platform)"),
            "imports": [], "schemas": ASSIGN_SCHEMA, "data": data}


sha1 = write(model(WALLS_V1, "v1"))
sha2 = write(model(WALLS_V2, "v2"))
write(catalog())
write(derivation(WALLS_V1, "v1", sha1))
write(derivation(WALLS_V2, "v2", sha2))
write(assignment_v1())
write(lineage(sha1, sha2))
write(assignment_v2())
