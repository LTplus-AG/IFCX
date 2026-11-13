"""Generate the .ifcx files of the Timber Junction example.

Run from anywhere with Python 3.8 or later, no packages needed:

    python3 generate.py [output-folder]

Without an argument the files are written next to this script, replacing the
committed ones. The output is deterministic: running it on an unchanged script
gives the committed files byte for byte.

It also writes IFC STEP twins of the two models to ifc-lite/, because ifc-lite
reads STEP and not IFCX. The lineage layer is translated from what ifc-lite
wrote when diffing those twins (ifc-lite/lineage-v1-v2.json, see LINEAGE_CMD).
"""
import hashlib, itertools, json, sys, uuid
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


def write_bytes(p, data):
    # Bytes, not text mode, so the files are LF on every OS and the hash is over what was written.
    p.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def write(f):
    data = (json.dumps(f, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    # What a derived layer records about the layer it was derived from.
    p = OUT / f["header"]["id"][len(ID_PREFIX):]
    return {"layer": f["header"]["id"], "sha256": write_bytes(p, data)}


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


def wall_box(x0, y0, length, thick):
    return (x0, y0, 0.0, x0 + length, y0 + thick, WALL_HEIGHT)


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
            "usd::usdgeom::mesh": box_mesh(*wall_box(x0, y0, length, thick)),
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


# ---- IFC STEP twins, for ifc-lite ------------------------------------------
# Same GlobalIds, names, IsExternal and boxes as model(), as IfcExtrudedAreaSolid.
STEP_DIR = "ifc-lite"
SIDECAR = Path(__file__).resolve().parent / STEP_DIR / "lineage-v1-v2.json"
IFC_LITE, DIFF_FLAGS = "@ifc-lite/cli@0.45.1", "--geometry --split-merge"
LINEAGE_CMD = (f'cd "{OUT / STEP_DIR}" && npx -y {IFC_LITE} diff model-v1.ifc model-v2.ifc {DIFF_FLAGS}'
               f' --lineage-out "{SIDECAR}"')
B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def ifc_guid(*parts):
    n = uuid.UUID(u("step", *parts)).int
    return "".join(B64[(n >> (6 * i)) & 63] for i in reversed(range(22)))


def step_str(s):
    return "'" + "".join(c if ord(c) < 128 else f"\\X2\\{ord(c):04X}\\X0\\" for c in s) + "'"


def step_model(walls, version):
    lines = [
        "#1=IFCPERSON($,'Example',$,$,$,$,$,$);",
        "#2=IFCORGANIZATION($,'DOKwood example',$,$,$);",
        "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
        "#4=IFCAPPLICATION(#2,'1.0','Timber Junction generate.py','tj');",
        "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,1700000000);",
        "#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
        "#11=IFCUNITASSIGNMENT((#10));",
        "#20=IFCCARTESIANPOINT((0.,0.,0.));",
        "#21=IFCDIRECTION((0.,0.,1.));",
        "#22=IFCDIRECTION((1.,0.,0.));",
        "#23=IFCAXIS2PLACEMENT3D(#20,#21,#22);",
        "#24=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#23,$);",
        "#25=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#24,$,.MODEL_VIEW.,$);",
        f"#30=IFCPROJECT('{ifc_guid('project')}',#5,'Timber Junction',$,$,$,$,(#24),#11);",
        "#31=IFCLOCALPLACEMENT($,#23);",
        f"#32=IFCSITE('{ifc_guid('site')}',#5,'Site',$,$,#31,$,$,.ELEMENT.,$,$,$,$,$);",
        "#33=IFCLOCALPLACEMENT(#31,#23);",
        f"#34=IFCBUILDING('{ifc_guid('building')}',#5,'Building',$,$,#33,$,$,.ELEMENT.,$,$,$);",
        "#35=IFCLOCALPLACEMENT(#33,#23);",
        f"#36=IFCBUILDINGSTOREY('{ifc_guid('storey')}',#5,'EG',$,$,#35,$,$,.ELEMENT.,0.);",
        f"#37=IFCRELAGGREGATES('{ifc_guid('agg', 'site')}',#5,$,$,#30,(#32));",
        f"#38=IFCRELAGGREGATES('{ifc_guid('agg', 'building')}',#5,$,$,#32,(#34));",
        f"#39=IFCRELAGGREGATES('{ifc_guid('agg', 'storey')}',#5,$,$,#34,(#36));",
    ]

    ids = itertools.count(100)

    def add(text):
        ref = f"#{next(ids)}"
        lines.append(f"{ref}={text};")
        return ref

    def product(cls, gid, name, box, kind):
        x0, y0, z0, x1, y1, z1 = box
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        origin = add(f"IFCCARTESIANPOINT(({x0:.3f},{y0:.3f},{z0:.3f}))")
        lp = add(f"IFCLOCALPLACEMENT(#35,{add(f'IFCAXIS2PLACEMENT3D({origin},#21,#22)')})")
        centre = add(f"IFCCARTESIANPOINT(({dx / 2:.3f},{dy / 2:.3f}))")
        profile = add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{add(f'IFCAXIS2PLACEMENT2D({centre},$)')},{dx:.3f},{dy:.3f})")
        solid = add(f"IFCEXTRUDEDAREASOLID({profile},#23,#21,{dz:.3f})")
        rep = add(f"IFCSHAPEREPRESENTATION(#25,'Body','SweptSolid',({solid}))")
        pds = add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))")
        return add(f"{cls}('{gid}',#5,{step_str(name)},$,$,{lp},{pds},$,{kind})")

    contained = []
    for _, gid, name, x0, y0, length, thick, ext in walls:
        w = product("IFCWALL", gid, name, wall_box(x0, y0, length, thick), ".STANDARD.")
        prop = add(f"IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN({'.T.' if ext else '.F.'}),$)")
        pset = add(f"IFCPROPERTYSET('{ifc_guid('pset', gid)}',#5,'Pset_WallCommon',$,({prop}))")
        add(f"IFCRELDEFINESBYPROPERTIES('{ifc_guid('rdp', gid)}',#5,$,$,({w}),{pset})")
        contained.append(w)
    contained.append(product("IFCSLAB", SLAB_GID, SLAB_NAME, SLAB_BOX, ".FLOOR."))
    add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{ifc_guid('contained')}',#5,$,$,({','.join(contained)}),#36)")
    return ("ISO-10303-21;\nHEADER;\n"
            f"FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]','Timber Junction {version}'),'2;1');\n"
            f"FILE_NAME('model-{version}.ifc','{DATE}T00:00:00',(''),(''),'','Timber Junction generate.py','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n" + "\n".join(lines) + "\nENDSEC;\nEND-ISO-10303-21;\n")


def write_step(walls, version):
    (OUT / STEP_DIR).mkdir(exist_ok=True)
    return write_bytes(OUT / STEP_DIR / f"model-{version}.ifc", step_model(walls, version).encode("ascii"))


S_REF = {"dataType": "Reference"}
S_STR = {"dataType": "String"}
S_REAL = {"dataType": "Real"}


def obj(values, optional=()):
    vals = {k: dict(v, optional=True) if k in optional else v for k, v in values.items()}
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


def derivation(walls, version, source):
    data, children = [], {}
    for _, gid, name, x0, y0, length, thick, _ in walls:
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
                                        sourceLayer=source["layer"],
                                        sourceSha256=source["sha256"]),
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
# ifc-lite LineageRelation; a rename or move is "identity" with a content-match reason.
RELATIONS = ("identity", "split", "merge", "replaced")
POLICIES = ("copy-to-all",)
ASSIGN_SCHEMA = {"dokwood::detail::assignment": {"value": obj({
    "state": enum("proposed", "in-review", "approved", "to-confirm"),
    "carriedFrom": obj({"occurrence": S_REF, "lineage": S_REF,
                        "relation": enum(*RELATIONS), "policy": enum(*POLICIES)}),
}, optional=("carriedFrom",))}}


def type_ref(code, ver):
    return f"{CATALOG}/{code}/{ver}"


W = {k: path_of(g) for k, g, *_ in WALLS_V1 + WALLS_V2}
KEY = {g: k for k, g, *_ in WALLS_V1 + WALLS_V2}
OCC = {k: occ_path(p, SLAB_P) for k, p in W.items()}

ASSIGN_V1 = [("W1", "D012", "v3", "approved"), ("W2", "D012", "v3", "in-review"), ("W3", "D021", "v1", "approved")]


def assignment_v1():
    data = [{"path": OCC[k], "inherits": {"detailType": type_ref(c, v)},
             "attributes": {"dokwood::detail::assignment": {"state": s}}} for k, c, v, s in ASSIGN_V1]
    return {"header": header("4-assignment-v1.ifcx", "detail editor (DOKwood platform)"),
            "imports": [], "schemas": ASSIGN_SCHEMA, "data": data}


LINEAGE = u("lineage", "v1", "v2")


def ifc_lite_lineage(step_v1, step_v2):
    """The sidecar's file and hash, and (predecessor keys, successor keys, relation, reason, shares) per entry."""
    if not SIDECAR.exists():
        sys.exit(f"{SIDECAR} is missing. Create it with: {LINEAGE_CMD}")
    raw = SIDECAR.read_bytes()
    side = json.loads(raw)
    if (side.get("format"), side.get("version")) != ("ifc-lite/lineage", 1):
        sys.exit(f"{SIDECAR.name} is not an ifc-lite/lineage v1 sidecar")
    for end, sha in (("base", step_v1), ("head", step_v2)):
        if side[end]["hash"] != "sha256:" + sha:
            sys.exit(f"{SIDECAR.name} {end} is not bound to the STEP twin written now. Rerun: {LINEAGE_CMD}")
    if side["deleted"]:
        sys.exit(f"{SIDECAR.name} lists deleted elements, which this example does not model")
    for e in side["entries"]:
        if e["relation"] not in RELATIONS or any(g not in KEY for g in e["base"] + e["head"]):
            sys.exit(f"{SIDECAR.name} has an entry this example does not model: {e}")
    # Also into OUT, so an output folder holds what the lineage points at.
    ref = {"file": f"{STEP_DIR}/{SIDECAR.name}", "sha256": write_bytes(OUT / STEP_DIR / SIDECAR.name, raw)}
    return ref, [([KEY[g] for g in e["base"]], [KEY[g] for g in e["head"]], e["relation"], e["reason"], e.get("shares"))
            for e in side["entries"]]


def lineage(base, head, sidecar, lineage_entries):
    entries = []
    for pre, suc, rel, ev, shares in lineage_entries:
        e = {"predecessors": [W[k] for k in pre], "successors": [W[k] for k in suc],
             "relation": rel, "evidence": ev}
        if shares:
            e["shares"] = shares
        entries.append(e)
    data = [{"path": LINEAGE, "attributes": {"dokwood::lineage": {
        "producer": f"{IFC_LITE} diff {DIFF_FLAGS}, run on the STEP twins in {STEP_DIR}/",
        "sidecar": sidecar,
        "base": base,
        "head": head,
        "entries": entries, "deleted": []}}}]
    model_ref = obj({"layer": S_STR, "sha256": S_STR})
    schemas = {"dokwood::lineage": {"value": obj({
        "producer": S_STR, "sidecar": obj({"file": S_STR, "sha256": S_STR}),
        "base": model_ref, "head": model_ref,
        "entries": arr(obj({"predecessors": arr(S_REF), "successors": arr(S_REF),
                            "relation": enum(*RELATIONS),
                            "evidence": S_STR, "shares": arr(S_REAL)}, optional=("shares",))),
        "deleted": arr(S_REF)})}}
    return {"header": header("4-lineage-v1-v2.ifcx", "model comparison (@ifc-lite/diff)"),
            "imports": [], "schemas": schemas, "data": data}


def assignment_v2(lineage_entries):
    # copy-to-all: every successor of an assigned occurrence gets the type, but must be re-confirmed.
    data = []
    by_old = {k: (c, v, s) for k, c, v, s in ASSIGN_V1}
    for pre, suc, rel, _, _ in lineage_entries:
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


sidecar, lineage_entries = ifc_lite_lineage(write_step(WALLS_V1, "v1"), write_step(WALLS_V2, "v2"))
m1 = write(model(WALLS_V1, "v1"))
m2 = write(model(WALLS_V2, "v2"))
write(catalog())
write(derivation(WALLS_V1, "v1", m1))
write(derivation(WALLS_V2, "v2", m2))
write(assignment_v1())
write(lineage(m1, m2, sidecar, lineage_entries))
write(assignment_v2(lineage_entries))
