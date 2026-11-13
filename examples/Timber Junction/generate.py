"""Generate the .ifcx files of the Timber Junction example.

Run from anywhere with Python 3.8 or later, no packages needed:

    python3 generate.py [output-folder]

Without an argument the files are written next to this script, replacing the
committed ones. The output is deterministic: running it on an unchanged script
gives the committed files byte for byte.

It also writes IFC STEP twins of the models to ifc-lite/, because ifc-lite
reads STEP and not IFCX. The lineage layers are translated from what ifc-lite
wrote when diffing those twins (ifc-lite/lineage-*.json, see lineage_cmd).
"""
import hashlib, itertools, json, sys, uuid
from collections import namedtuple
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE
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


def ifcx_file(name, author, data, schemas, imports=()):
    return {"header": header(name, author), "imports": list(imports), "schemas": schemas, "data": data}


def write_bytes(p, data):
    # Bytes, not text mode, so the files are LF on every OS and the hash is over what was written.
    p.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def write(f):
    data = (json.dumps(f, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    p = OUT / f["header"]["id"][len(ID_PREFIX):]
    # What a derived layer records about the layer it was derived from.
    return {"layer": f["header"]["id"], "sha256": write_bytes(p, data)}


def record_sha(record):
    """SHA-256 of one attribute value, as sorted compact JSON. What an approval says it reviewed.

    Whole floats are written as integers, as JSON.stringify does, so the test can recompute it.
    Not a general canonical form: exponents still differ between Python and JS (RFC 8785 would fix that).
    """
    def plain(v):
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, dict):
            return {k: plain(x) for k, x in v.items()}
        return [plain(x) for x in v] if isinstance(v, list) else v
    return hashlib.sha256(json.dumps(plain(record), sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode("utf-8")).hexdigest()


# One wall or slab. box is (x0, y0, z0, x1, y1, z1); external is None for slabs.
Element = namedtuple("Element", "key gid name cls box external")
WALL_HEIGHT = 2.6


def wall(key, gid, name, x0, y0, length, thick, external):
    return Element(key, gid, name, "IfcWall", (x0, y0, 0.0, x0 + length, y0 + thick, WALL_HEIGHT), external)


def balcony(key, gid, name, x0, x1):
    # Outside Wand 2, flush with the top of the floor slab, 0.16 thick.
    return Element(key, gid, name, "IfcSlab", (x0, 5.24, WALL_HEIGHT + 0.08, x1, 6.74, WALL_HEIGHT + 0.24), None)


# GlobalIds of the walls from wp9-identity-demo.
WALLS_V1 = [
    wall("W1", "1WandW1altAussenwand01", "Wand 1", 0.0, 0.0, 6.0, 0.24, True),
    wall("W2", "1WandW2altAussenwand02", "Wand 2", 0.0, 5.0, 6.0, 0.24, True),
    wall("W3", "1WandW3InnenwandStabil", "Wand 3", 0.0, 2.5, 3.0, 0.12, False),
    wall("W4", "1WandW4altInnenwand004", "Wand 4", 3.5, 2.5, 2.5, 0.12, False),
]
WALLS_V2 = [
    wall("W1a", "2WandW1aNeuTeilstueckA", "Wand 1.1", 0.0, 0.0, 4.0, 0.24, True),
    wall("W1b", "2WandW1bNeuTeilstueckB", "Wand 1.2", 4.0, 0.0, 2.0, 0.24, True),
    wall("W2neu", "2WandW2NeuNurNeueGuid2", "Wand 2", 0.0, 5.0, 6.0, 0.24, True),
    WALLS_V1[2],
    wall("W4neu", "2WandW4NeuVerschoben04", "Wand 4", 3.5, 3.0, 2.5, 0.12, False),
]
# Second scenario: the same v2, but both pieces of Wand 1 keep the old name.
WALLS_V2_SAMENAME = [w._replace(name="Wand 1") if w.key in ("W1a", "W1b") else w for w in WALLS_V2]
SLAB = Element("S", "1DeckeUeberEGStabil001", "Decke über EG", "IfcSlab",
               (0.0, 0.0, WALL_HEIGHT, 6.0, 5.24, WALL_HEIGHT + 0.24), None)
SLAB_P = path_of(SLAB.gid)
# Two balcony slab pieces in v1, merged into one in v2.
BALCONY_V1 = [balcony("BA", "1BalkonplatteTeilA0001", "Balkonplatte A", 0.0, 3.0),
              balcony("BB", "1BalkonplatteTeilB0001", "Balkonplatte B", 3.0, 6.0)]
BALCONY_V2 = [balcony("B", "2BalkonplatteGanz00001", "Balkonplatte", 0.0, 6.0)]
MODELS = {"v1": WALLS_V1 + [SLAB] + BALCONY_V1,
          "v2": WALLS_V2 + [SLAB] + BALCONY_V2,
          "v2-samename": WALLS_V2_SAMENAME + [SLAB] + BALCONY_V2}

STOREY = u("storey")
CATALOG = u("catalog")
OCC_GROUP = u("detail-occurrences")


def slug(name):
    return name.replace(" ", "_").replace(".", "_").replace("ü", "ue")


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


def add_child(children, name, key, path):
    # Two pieces both named "Wand 1" need distinct child names.
    children[name if name not in children else f"{name}_{key}"] = path


def model(version):
    data, children = [], {}
    for e in MODELS[version]:
        p, body = path_of(e.gid), u("body", e.gid)
        add_child(children, slug(e.name), e.key, p)
        attrs = {"bsi::ifc::class": ifc_class(e.cls), "bsi::ifc::prop::Name": e.name}
        look = {"bsi::ifc::presentation::diffuseColor": [0.7, 0.7, 0.7], "bsi::ifc::presentation::opacity": 0.4}
        if e.external is not None:
            attrs["bsi::ifc::prop::IsExternal"] = e.external
            look = {"bsi::ifc::presentation::diffuseColor": [0.82, 0.68, 0.47] if e.external else [0.9, 0.82, 0.66]}
        data.append({"path": p, "children": {"Body": body}, "attributes": attrs})
        data.append({"path": body, "attributes": {"usd::usdgeom::mesh": box_mesh(*e.box), **look}})
    data.insert(0, {"path": STOREY, "children": children, "attributes": {
        "bsi::ifc::class": ifc_class("IfcBuildingStorey"),
        "bsi::ifc::prop::Name": "EG",
    }})
    return ifcx_file(f"1-model-{version}.ifcx", "architect (authoring tool export)", data, {}, MODEL_IMPORTS)


# ---- IFC STEP twins, for ifc-lite ------------------------------------------
# Same GlobalIds, names, IsExternal and boxes as model(), as IfcExtrudedAreaSolid.
STEP_DIR = "ifc-lite"
IFC_LITE, DIFF_FLAGS = "@ifc-lite/cli@0.45.1", "--geometry --split-merge"
B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def sidecar_path(head):
    return HERE / STEP_DIR / f"lineage-v1-{head}.json"


def lineage_cmd(head):
    return (f'cd "{OUT / STEP_DIR}" && npx -y {IFC_LITE} diff model-v1.ifc model-{head}.ifc {DIFF_FLAGS}'
            f' --lineage-out "{sidecar_path(head)}"')


def ifc_guid(*parts):
    n = uuid.UUID(u("step", *parts)).int
    return "".join(B64[(n >> (6 * i)) & 63] for i in reversed(range(22)))


def step_str(s):
    if any(ord(c) > 0xFFFF for c in s):
        raise ValueError(f"{s!r}: characters above U+FFFF need \\X4\\, which this writer does not do")
    s = s.replace("\\", "\\\\").replace("'", "''")
    return "'" + "".join(c if ord(c) < 128 else f"\\X2\\{ord(c):04X}\\X0\\" for c in s) + "'"


def step_model(version):
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

    contained = []
    for e in MODELS[version]:
        x0, y0, z0, x1, y1, z1 = e.box
        if any(abs(c * 1000 - round(c * 1000)) > 1e-6 for c in e.box):
            raise ValueError(f"{e.name}: the STEP twin writes millimetres, {e.box} is finer")
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        origin = add(f"IFCCARTESIANPOINT(({x0:.3f},{y0:.3f},{z0:.3f}))")
        lp = add(f"IFCLOCALPLACEMENT(#35,{add(f'IFCAXIS2PLACEMENT3D({origin},#21,#22)')})")
        centre = add(f"IFCCARTESIANPOINT(({dx / 2:.4f},{dy / 2:.4f}))")  # exact for whole millimetres
        profile = add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{add(f'IFCAXIS2PLACEMENT2D({centre},$)')},{dx:.3f},{dy:.3f})")
        solid = add(f"IFCEXTRUDEDAREASOLID({profile},#23,#21,{dz:.3f})")
        rep = add(f"IFCSHAPEREPRESENTATION(#25,'Body','SweptSolid',({solid}))")
        pds = add(f"IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))")
        kind = ".STANDARD." if e.cls == "IfcWall" else ".FLOOR."
        p = add(f"{e.cls.upper()}('{e.gid}',#5,{step_str(e.name)},$,$,{lp},{pds},$,{kind})")
        if e.external is not None:
            prop = add(f"IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN({'.T.' if e.external else '.F.'}),$)")
            pset = add(f"IFCPROPERTYSET('{ifc_guid('pset', e.gid)}',#5,'Pset_WallCommon',$,({prop}))")
            add(f"IFCRELDEFINESBYPROPERTIES('{ifc_guid('rdp', e.gid)}',#5,$,$,({p}),{pset})")
        contained.append(p)
    add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{ifc_guid('contained')}',#5,$,$,({','.join(contained)}),#36)")
    return ("ISO-10303-21;\nHEADER;\n"
            f"FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]','Timber Junction {version}'),'2;1');\n"
            f"FILE_NAME('model-{version}.ifc','{DATE}T00:00:00',(''),(''),'','Timber Junction generate.py','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n" + "\n".join(lines) + "\nENDSEC;\nEND-ISO-10303-21;\n")


def write_step(version):
    (OUT / STEP_DIR).mkdir(exist_ok=True)
    return write_bytes(OUT / STEP_DIR / f"model-{version}.ifc", step_model(version).encode("ascii"))


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
    "D012": (["v2", "v3"], "Deckenauflager aussen", "slab-on-wall",
             [("bearing", "AW Holzrahmen 240"), ("supported", "Decke Holz 240")]),
    "D021": (["v1"], "Innenwand unter Decke", "slab-on-wall",
             [("bearing", "IW Holzrahmen 120"), ("supported", "Decke Holz 240")]),
    "D031": (["v1"], "Balkonanschluss", "slab-to-slab",
             [("bearing", "Decke Holz 240"), ("supported", "Balkonplatte Holz 160")]),
}


def catalog():
    data = [{"path": CATALOG, "children": {code: u("type", code) for code in DETAIL_TYPES},
             "attributes": {"dokwood::catalog": {"name": "DOKwood Detailkatalog (example)",
                                                 "publisher": "DOKwood platform"}}}]
    for code, (vers, _, _, _) in DETAIL_TYPES.items():
        data.append({"path": u("type", code), "children": {v: u("type", code, v) for v in vers}})
    for code, (vers, name, junction, roles) in DETAIL_TYPES.items():
        for ver in vers:
            data.append({"path": u("type", code, ver), "attributes": {"dokwood::detail::type": {
                "code": code, "name": name, "version": ver, "junction": junction,
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
    return ifcx_file("2-catalog.ifcx", "DOKwood platform (detail catalog)", data, schemas)


# ---- derivation ----------------------------------------------------------
ENGINE = {"engine": "detail-finder", "engineVersion": "1.4.0", "tolerance": 0.001}
MEMBERS_SCHEMA = {"dokwood::detail::members": {"value": arr(obj({"ref": S_REF, "role": S_STR}))}}
TOPOLOGY_SCHEMA = {"dokwood::detail::topology": {"value": obj({"junction": S_STR, "extent": obj({
    "kind": enum("point", "line", "area"), "length": S_REAL, "start": S_POINT, "end": S_POINT},
    optional=("length", "start", "end"))})}}


Junction = namedtuple("Junction", "key name kind bearing supported extent")


def occ_path(kind, bearing, supported):
    # Name is a pure function of the inputs: junction kind plus sorted member paths.
    return u("occurrence", kind, *sorted([bearing, supported]))


def line(x0, x1, y, z):
    return {"kind": "line", "length": round(x1 - x0, 4), "start": [x0, y, z], "end": [x1, y, z]}


def members(bearing, supported):
    return [{"ref": bearing, "role": "bearing"}, {"ref": supported, "role": "supported"}]


def junctions(version):
    """One Junction per occurrence; key is the wall or balcony piece it belongs to."""
    out = []
    for e in MODELS[version]:
        x0, y0, z0, x1, y1, z1 = e.box
        if e.cls == "IfcWall":
            # Along the wall axis, on top of the wall.
            out.append(Junction(e.key, slug(e.name) + "__Decke", "slab-on-wall", path_of(e.gid), SLAB_P,
                                line(x0, x1, round((y0 + y1) / 2, 4), WALL_HEIGHT)))
        elif e is not SLAB:
            # Along the edge where the balcony meets the floor slab, at its top.
            out.append(Junction(e.key, "Decke__" + slug(e.name), "slab-to-slab", SLAB_P, path_of(e.gid),
                                line(x0, x1, y0, z1)))
    return out


def derivation(version, source):
    data, children = [], {}
    for j in junctions(version):
        add_child(children, j.name, j.key, OCC[j.key])
        data.append({"path": OCC[j.key], "attributes": {
            "dokwood::detail::members": members(j.bearing, j.supported),
            "dokwood::detail::topology": {"junction": j.kind, "extent": j.extent},
            "dokwood::derivation": dict(ENGINE, operation="junction-detection",
                                        sources=sorted([j.bearing, j.supported]),
                                        sourceLayer=source["layer"],
                                        sourceSha256=source["sha256"]),
        }})
    data.insert(0, {"path": OCC_GROUP, "children": children,
                    "attributes": {"bsi::ifc::prop::Name": "Detail occurrences (derived)"}})
    schemas = {**MEMBERS_SCHEMA, **TOPOLOGY_SCHEMA}
    schemas["dokwood::derivation"] = {"value": obj({
        "operation": S_STR, "engine": S_STR, "engineVersion": S_STR, "tolerance": S_REAL,
        "sources": arr(S_REF), "sourceLayer": S_STR, "sourceSha256": S_STR})}
    return ifcx_file(f"3-derivation-{version}.ifcx", "detail-finder 1.4.0 (derived, do not edit)", data, schemas,
                     [PROP_IMPORT])


def derivation_shas(f):
    return {d["path"]: record_sha(d["attributes"]["dokwood::derivation"])
            for d in f["data"] if "dokwood::derivation" in d.get("attributes", {})}


# ---- assignment + lineage ------------------------------------------------
# ifc-lite LineageRelation; a rename or move is "identity" with a content-match reason.
RELATIONS = ("identity", "split", "merge", "replaced")
# copy-to-all: every successor gets the type. same-type-or-none: a merge gets the type only if
# every predecessor had the same type and version.
POLICIES = ("copy-to-all", "same-type-or-none")
ASSIGN_SCHEMA = {"dokwood::detail::assignment": {"value": obj({
    "state": enum("proposed", "in-review", "approved", "to-confirm"),
    "reviewedSha256": S_STR,
    "carriedFrom": obj({"occurrences": arr(S_REF), "lineage": S_REF,
                        "relation": enum(*RELATIONS), "policy": enum(*POLICIES)}),
}, optional=("reviewedSha256", "carriedFrom"))}}


def type_ref(code, ver):
    return f"{CATALOG}/{code}/{ver}"


ELEMENTS = {e.key: e for m in MODELS.values() for e in m}
# Scenarios share keys only for the same element, so one key means one GlobalId.
assert all(ELEMENTS[e.key].gid == e.gid for m in MODELS.values() for e in m)
W = {k: path_of(e.gid) for k, e in ELEMENTS.items()}
KEY = {e.gid: k for k, e in ELEMENTS.items()}
OCC = {j.key: occ_path(j.kind, j.bearing, j.supported) for v in MODELS for j in junctions(v)}

ASSIGN_V1 = [("W1", "D012", "v3", "approved"), ("W2", "D012", "v3", "in-review"), ("W3", "D021", "v1", "approved"),
             ("BA", "D031", "v1", "approved"), ("BB", "D031", "v1", "in-review")]


def assignment_node(occ, code, ver, state, reviewed=None, carried=None):
    a = {"state": state}
    if reviewed:
        a["reviewedSha256"] = reviewed
    if carried:
        a["carriedFrom"] = carried
    return {"path": occ, "inherits": {"detailType": type_ref(code, ver)},
            "attributes": {"dokwood::detail::assignment": a}}


def reviewed_v1(shas):
    """key -> (code, version, state, reviewedSha256). An approval records the hash of the derivation it approved."""
    return {k: (c, v, s, shas[OCC[k]] if s == "approved" else None) for k, c, v, s in ASSIGN_V1}


def assignment_v1(shas):
    data = [assignment_node(OCC[k], *a) for k, a in reviewed_v1(shas).items()]
    return ifcx_file("4-assignment-v1.ifcx", "detail editor (DOKwood platform)", data, ASSIGN_SCHEMA)


def lineage_path(head, *extra):
    return u("lineage", "v1", head, *extra)


def ifc_lite_lineage(head, step_v1, step_head):
    """The sidecar's file and hash, and its entries as ifc-lite wrote them."""
    sidecar = sidecar_path(head)
    if not sidecar.exists():
        sys.exit(f"{sidecar} is missing. Create it with: {lineage_cmd(head)}")
    raw = sidecar.read_bytes()
    side = json.loads(raw)
    if (side.get("format"), side.get("version")) != ("ifc-lite/lineage", 1):
        sys.exit(f"{sidecar.name} is not an ifc-lite/lineage v1 sidecar")
    for end, sha in (("base", step_v1), ("head", step_head)):
        if side[end]["hash"] != "sha256:" + sha:
            sys.exit(f"{sidecar.name} {end} is not bound to the STEP twin written now. Rerun: {lineage_cmd(head)}")
    if side["deleted"]:
        sys.exit(f"{sidecar.name} lists deleted elements, which this example does not model")
    # Only elements with an occurrence (walls, balcony pieces), from the right model.
    in_model = {v: {e.gid for e in MODELS[v] if e.key in OCC} for v in ("v1", head)}
    for e in side["entries"]:
        n_base, n_head = len(e["base"]), len(e["head"])
        shape = {"merge": n_base >= 2 and n_head == 1, "split": n_base == 1 and n_head >= 2}
        shares = e.get("shares")
        rules = [
            (e["relation"] in RELATIONS, "unknown relation"),
            (isinstance(e.get("reason"), str), "no reason"),
            (set(e["base"]) <= in_model["v1"], "base is not an element with an occurrence in v1"),
            (set(e["head"]) <= in_model[head], f"head is not an element with an occurrence in {head}"),
            (shape.get(e["relation"], n_base == 1 and n_head == 1), f"{n_base}:{n_head} for {e['relation']}"),
            (shares is None or (len(shares) == max(n_base, n_head) and abs(sum(shares) - 1) <= 1e-9), "bad shares"),
        ]
        for ok, why in rules:
            if not ok:
                sys.exit(f"{sidecar.name} has an entry this example does not model ({why}): {e}")
    # Also into OUT, so an output folder holds what the lineage points at.
    ref = {"file": f"{STEP_DIR}/{sidecar.name}", "sha256": write_bytes(OUT / STEP_DIR / sidecar.name, raw)}
    return ref, side["entries"]


LINEAGE_SCHEMA = {"dokwood::lineage": {"value": obj({
    "producer": S_STR, "sidecar": obj({"file": S_STR, "sha256": S_STR}),
    "base": obj({"layer": S_STR, "sha256": S_STR}), "head": obj({"layer": S_STR, "sha256": S_STR}),
    "entries": arr(obj({"predecessors": arr(S_REF), "successors": arr(S_REF),
                        "relation": enum(*RELATIONS), "evidence": S_STR, "shares": arr(S_REAL),
                        "source": enum("ifc-lite", "manual"), "author": S_STR, "timestamp": S_STR},
                       optional=("shares", "author", "timestamp"))),
    "deleted": arr(S_REF)}, optional=("sidecar",))}}


def lineage_file(name, path, author, value):
    return ifcx_file(name, author, [{"path": path, "attributes": {"dokwood::lineage": value}}], LINEAGE_SCHEMA)


def lineage(head, base_ref, head_ref, sidecar, entries):
    out = []
    for side in entries:
        e = {"predecessors": [path_of(g) for g in side["base"]], "successors": [path_of(g) for g in side["head"]],
             "relation": side["relation"], "evidence": side["reason"], "source": "ifc-lite"}
        if "shares" in side:
            e["shares"] = side["shares"]
        out.append(e)
    return lineage_file(f"4-lineage-v1-{head}.ifcx", lineage_path(head), "model comparison (@ifc-lite/diff)", {
        "producer": f"{IFC_LITE} diff {DIFF_FLAGS}, run on the STEP twins in {STEP_DIR}/",
        "sidecar": sidecar, "base": base_ref, "head": head_ref, "entries": out, "deleted": []})


MANUAL_AUTHOR = "planner (manual review in detail editor)"
MANUAL_TIME = DATE + "T10:30:00Z"


def manual_lineage(head, base_ref, head_ref):
    # ifc-lite took the larger piece for a reshaped Wand 1 and missed the split; a person states it.
    entry = {"predecessors": [W["W1"]], "successors": [W["W1a"], W["W1b"]], "relation": "split",
             "evidence": "manual:checked-against-plan", "source": "manual",
             "author": MANUAL_AUTHOR, "timestamp": MANUAL_TIME}
    return lineage_file(f"4-lineage-v1-{head}-manual.ifcx", lineage_path(head, "manual"), MANUAL_AUTHOR, {
        "producer": MANUAL_AUTHOR, "base": base_ref, "head": head_ref, "entries": [entry], "deleted": []})


def carried_state(state, reviewed, current):
    # An approval holds only for the derivation it reviewed.
    return "to-confirm" if reviewed and reviewed != current else state


def assignment_v2(head, entries, shas_v1, shas_v2):
    old = reviewed_v1(shas_v1)
    data = []
    # Same path in v2: the derivation was redone, so a stale approval drops to to-confirm.
    for k, (c, v, s, rev) in old.items():
        state = carried_state(s, rev, shas_v2[OCC[k]]) if OCC[k] in shas_v2 else s
        if state != s:
            data.append(assignment_node(OCC[k], c, v, state, rev))
    for e in entries:
        pre, suc, rel = [KEY[g] for g in e["base"]], [KEY[g] for g in e["head"]], e["relation"]
        if not any(k in old for k in pre):
            continue
        carried = {"occurrences": [OCC[k] for k in pre], "lineage": lineage_path(head), "relation": rel}
        if rel == "merge":
            types = {old[k][:2] if k in old else None for k in pre}
            if len(types) == 1 and None not in types:
                (c, v), = types
                data.append(assignment_node(OCC[suc[0]], c, v, "to-confirm",
                                            carried=dict(carried, policy="same-type-or-none")))
        else:
            c, v, s, rev = old[pre[0]]
            for k in suc:
                # Only an identity keeps its state; anything else is a new occurrence to confirm.
                state = carried_state(s, rev, shas_v2[OCC[k]]) if rel == "identity" else "to-confirm"
                data.append(assignment_node(OCC[k], c, v, state, rev, dict(carried, policy="copy-to-all")))
    if len({d["path"] for d in data}) != len(data):
        raise ValueError("two carried assignments for one occurrence")
    return ifcx_file("4-assignment-v2.ifcx", "detail editor (DOKwood platform)", data, ASSIGN_SCHEMA)


# ---- manual split ----------------------------------------------------------
SPLIT_SCHEMA = {"dokwood::detail::manualSplit": {"value": obj({"reason": S_STR, "author": S_STR, "timestamp": S_STR})}}


def manual_split():
    # A person splits the Wand 2 occurrence at the balcony door, x 2.50 to 3.50, written against v1.
    occ = OCC["W2"]
    j, = [j for j in junctions("v1") if j.key == "W2"]
    _, y, z = j.extent["start"]
    parts = {n: (u("manual-part", occ, n), x0, x1) for n, x0, x1 in (("Teil_1", 0.0, 2.5), ("Teil_2", 3.5, 6.0))}
    data = [{"path": occ, "children": {n: p for n, (p, _, _) in parts.items()},
             "attributes": {"dokwood::detail::manualSplit": {
                 "reason": "balcony door from x 2.50 to 3.50", "author": MANUAL_AUTHOR, "timestamp": MANUAL_TIME}}}]
    for p, x0, x1 in parts.values():
        data.append({"path": p, "attributes": {
            "dokwood::detail::members": members(j.bearing, j.supported),
            "dokwood::detail::topology": {"junction": j.kind, "extent": line(x0, x1, y, z)},
        }})
    return ifcx_file("4-manual-split.ifcx", MANUAL_AUTHOR, data, {**SPLIT_SCHEMA, **MEMBERS_SCHEMA, **TOPOLOGY_SCHEMA})


steps = {v: write_step(v) for v in MODELS}
sidecars = {h: ifc_lite_lineage(h, steps["v1"], steps[h]) for h in ("v2", "v2-samename")}
m = {v: write(model(v)) for v in MODELS}
write(catalog())
d1, d2 = derivation("v1", m["v1"]), derivation("v2", m["v2"])
shas_v1, shas_v2 = derivation_shas(d1), derivation_shas(d2)
write(d1)
write(d2)
write(assignment_v1(shas_v1))
write(manual_split())
for h, (side, entries) in sidecars.items():
    write(lineage(h, m["v1"], m[h], side, entries))
write(assignment_v2("v2", sidecars["v2"][1], shas_v1, shas_v2))
write(manual_lineage("v2-samename", m["v1"], m["v2-samename"]))
