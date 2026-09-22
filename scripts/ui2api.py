#!/usr/bin/env python3
"""Converte templates ComfyUI (formato UI, com subgraphs) para formato API.

Uso:  python3 ui2api.py template.json out.json [--unet-class UnetLoaderGGUF] [--unet-name arquivo.gguf]

Regras:
- Nós não alcançáveis a partir do SaveImage são podados (MarkdownNote, ImageCompare...).
- Nós cujo tipo é um uuid de subgraph são expandidos (inputs do subgraph resolvidos
  pelos widgets/links do nó instância no topo).
- ResolutionSelector é substituído por literais de width/height (via --width/--height).
- SaveImageAdvanced vira SaveImage (API amigável).
- Inputs widget-only vêm de widgets_values_named (ou widgets_values posicional).
"""
import json, sys, argparse, collections

parser = argparse.ArgumentParser()
parser.add_argument("src")
parser.add_argument("dst")
parser.add_argument("--unet-class", default=None)
parser.add_argument("--unet-name", default=None)
parser.add_argument("--width", type=int, default=1024)
parser.add_argument("--height", type=int, default=1024)
args = parser.parse_args()

FRONTEND_ONLY = {"control_after_generate", "upload", "format.bit_depth", "format.input_color_space"}

data = json.load(open(args.src, encoding="utf-8"))
report = []

# ---------- helpers ----------
def widget_map(node):
    w = node.get("widgets_values_named")
    if isinstance(w, dict):
        return dict(w)
    wv = node.get("widgets_values")
    if isinstance(wv, dict):
        return dict(wv)
    return {}  # posicional sem nome: tratado à parte pelo validador

def prune(nodes, links, sink_ids):
    """mantém apenas nós alcançáveis de trás para frente a partir dos sinks"""
    keep = set()
    stack = list(sink_ids)
    by_id = {n["id"]: n for n in nodes}
    # índice: target_id -> links
    incoming = collections.defaultdict(list)
    for l in links:
        incoming[l["target_id"]].append(l)
    while stack:
        nid = stack.pop()
        if nid in keep:
            continue
        keep.add(nid)
        for l in incoming.get(nid, []):
            if l["origin_id"] >= 0 and l["origin_id"] not in keep:
                stack.append(l["origin_id"])
    return ([n for n in nodes if n["id"] in keep],
            [l for l in links if (l["origin_id"] in keep or l["origin_id"] == -10)
             and (l["target_id"] in keep or l["target_id"] == -20)])

def convert_graph(nodes, links, resolve_boundary_origin, prefix):
    """retorna dict {novo_id: {class_type, inputs}} — resolve_boundary_origin(slot)->ref|[val]"""
    out = {}
    link_by_target = collections.defaultdict(dict)  # target_id -> {inputname via node entry}
    # mapa link_id -> (origin_id, origin_slot)
    lid = {l["id"]: (l["origin_id"], l["origin_slot"]) for l in links}
    # mapa consumidor: (target_id, target_slot) -> link
    tslot = {(l["target_id"], l["target_slot"]): l for l in links}

    for idx, n in enumerate(nodes):
        nid = n["id"]
        cls = n.get("type", "")
        if cls == "ResolutionSelector":
            continue
        if cls == "MarkdownNote" or cls == "ImageCompare":
            continue
        if cls == "SaveImageAdvanced":
            cls = "SaveImage"
        if args.unet_class and cls in ("UNETLoader", "UnetLoaderGGUF"):
            cls = args.unet_class
        if cls.startswith("c291") or cls.startswith("bc1c9"):  # uuid de subgraph
            raise RuntimeError("subgraph aninhado não suportado")

        new_id = f"{prefix}{idx+1}"
        inputs = {}

        # 1) entradas com link
        for i, entry in enumerate(n.get("inputs", [])):
            name = entry.get("name")
            lref = entry.get("link")
            if lref is None:
                continue
            if lref not in lid:
                report.append(f"  ! link {lref} ausente (node {nid} input {name})")
                continue
            o_id, o_slot = lid[lref]
            if o_id == -10:  # boundary do subgraph
                inputs[name] = resolve_boundary_origin(o_slot, name)
            else:
                src = find_out_id(nodes, o_id, prefix)
                if src:
                    inputs[name] = [src, o_slot]
            if inputs.get(name) is None:
                inputs.pop(name, None)

        # 2) widgets (não sobrescrevem links)
        wm = widget_map(n)
        if cls == "SaveImage":
            wm = {k: v for k, v in wm.items() if k == "filename_prefix"}
        if args.unet_class and cls == args.unet_class:
            wm = {k: v for k, v in wm.items() if k == "unet_name"}
            if args.unet_name:
                wm["unet_name"] = args.unet_name
        for k, v in wm.items():
            if k not in inputs and k not in FRONTEND_ONLY:
                inputs[k] = v

        # força o arquivo do transformer (veio do boundary como link, não widget)
        if args.unet_class and cls == args.unet_class and args.unet_name:
            inputs["unet_name"] = args.unet_name

        out[new_id] = {"class_type": cls, "inputs": inputs, "_src": nid}

    # mapear id origem -> novo id
    idmap = {n["id"]: f"{prefix}{i+1}" for i, n in enumerate(nodes)
             if n.get("type") not in ("ResolutionSelector", "MarkdownNote", "ImageCompare")}
    # refs nos inputs: substituir _orig por id mapeado
    return out, idmap

def find_out_id(nodes, orig_id, prefix):
    for i, n in enumerate(nodes):
        if n["id"] == orig_id:
            t = n.get("type", "")
            if t in ("ResolutionSelector", "MarkdownNote", "ImageCompare"):
                return None
            return f"{prefix}{i+1}"
    return None

def clean_refs(api, idmap):
    for nid, node in api.items():
        node.pop("_src", None)
        for k, v in list(node["inputs"].items()):
            if isinstance(v, str) and v.startswith("@orig:"):
                pass
    return api

# ---------- topo ----------
top_nodes = data["nodes"]
top_links = [dict(zip(["id","origin_id","origin_slot","target_id","target_slot","type"], l))
             for l in data.get("links", [])]

subgraphs = {sg["id"]: sg for sg in data.get("definitions", {}).get("subgraphs", [])}

# valores de entrada do subgraph: do nó instância (widgets + links externos)
def outer_values(sgnode, sg):
    """nome_do_input_do_subgraph -> valor literal ou ref [node,slot] vinda do grafo de cima"""
    vals = {}
    lids = {l["id"]: (l["origin_id"], l["origin_slot"]) for l in top_links}
    wm = widget_map(sgnode)
    for k, v in wm.items():
        vals[k] = v
    for entry in sgnode.get("inputs", []):
        lref = entry.get("link")
        name = entry.get("name")
        if lref is None:
            continue
        o_id, o_slot = lids[lref]
        t = next((n.get("type") for n in top_nodes if n["id"] == o_id), None)
        if t == "ResolutionSelector":
            vals[name] = args.width if "width" in name or o_slot == 0 else args.height
            if name == "width":
                vals[name] = args.width
            if name == "height":
                vals[name] = args.height
        else:
            vals[name] = [f"{o_id}", o_slot]  # id top-level (string) p/ remapear depois
    return vals

# localizar o nó subgraph + o SaveImage do topo
sgnode = next((n for n in top_nodes if n.get("type") in subgraphs), None)
savenode = next(n for n in top_nodes if n.get("type") in ("SaveImageAdvanced", "SaveImage"))
if sgnode is None:
    sys.exit("nenhum subgraph encontrado")

sg = subgraphs[sgnode["type"]]
ov = outer_values(sgnode, sg)
sg_inputs_order = sg["inputs"]  # lista ordenada: origin_slot -10 -> índice

def resolve_boundary(slot, inner_name=None):
    if slot >= len(sg_inputs_order):
        report.append(f"  ! boundary slot {slot} fora de ordem")
        return None
    name = sg_inputs_order[slot]["name"]
    if name not in ov:
        report.append(f"  ! input do subgraph sem valor: {name}")
        return None
    return ov[name]

# podar subgraph: manter só o que alimenta a saída IMAGE (-20)
sg_nodes = sg["nodes"]
sg_links = [dict(l) for l in sg["links"]]
sg_nodes, sg_links = prune(sg_nodes, sg_links, [l["origin_id"] for l in sg_links if l["target_id"] == -20])
report.append(f"subgraph '{sg['name']}': {len(sg_nodes)} nós após poda: " +
              ", ".join(sorted({n.get('type','?') for n in sg_nodes})))

api, idmap = convert_graph(sg_nodes, sg_links, resolve_boundary, "sg")

# refs internas do subgraph usam ids novos; mas convert_graph já emitiu ids novos
# refs externas (ids de topo como string) no boundary resolvido: valores [origId, slot]
# -> o boundary só devolve valor literal ou ref de topo; refs de topo são resolvidas no passo do SaveImage.
# SaveImage do topo:
sg_out_slot = 0  # saída IMAGE
# achar o link interno que chega em -20 (origem real da saída)
origin_of_output = next(l["origin_id"] for l in sg["links"] if l["target_id"] == -20 and l["target_slot"] == sg_out_slot)
# mapear origem interna (id origem) para novo id interno
orig_index = {n["id"]: i for i, n in enumerate(sg_nodes)}
inner_out_id = None
for i, n in enumerate(sg_nodes):
    if n["id"] == origin_of_output:
        inner_out_id = f"sg{i+1}"
if inner_out_id is None:
    # origem da saída foi podada? impossível (é ancestor do sink)
    sys.exit("saída do subgraph não encontrada após poda")

# montar SaveImage final
save_cls = "SaveImage"
save_inputs = {"images": [inner_out_id, 0],
               "filename_prefix": widget_map(savenode).get("filename_prefix", "Qwen_image_2.1")}
api["out"] = {"class_type": save_cls, "inputs": save_inputs}

# limpar refs de topo nos inputs internos: boundary devolveu [origId(topo string), slot]
# -> ex.: width/height vindos de ResolutionSelector viraram literais; outros vêm de nós do topo
top_idmap = {}
for i, n in enumerate(top_nodes):
    if n is savenode or n is sgnode:
        continue
    t = n.get("type", "")
    if t in ("MarkdownNote", "ImageCompare", "ResolutionSelector"):
        continue
    top_idmap[str(n["id"])] = f"top{i+1}"

# nós do topo além de sg/save (raro: ex. LoadImage do edit está no topo e alimenta o subgraph)
top_extra_nodes = [n for n in top_nodes if n not in (sgnode, savenode)
                   and n.get("type") not in ("MarkdownNote", "ImageCompare", "ResolutionSelector")]
if top_extra_nodes:
    # converter os nós extras do topo (ex.: LoadImage) — precisam dos links do topo
    extra_api, extra_idmap = [], {}
    # localização simples: ids "top<i>"
    incoming = collections.defaultdict(dict)
    for l in top_links:
        pass
    lid_top = {l["id"]: (l["origin_id"], l["origin_slot"]) for l in top_links}
    slot_top = {(l["target_id"], l["target_slot"]): l for l in top_links}
    for i, n in enumerate(top_nodes):
        if n in (sgnode, savenode) or n.get("type") in ("MarkdownNote", "ImageCompare", "ResolutionSelector"):
            continue
        cls = n.get("type")
        new_id = f"top{i+1}"
        inputs = {}
        for entry in n.get("inputs", []):
            lref = entry.get("link")
            if lref is None:
                continue
            o_id, o_slot = lid_top[lref]
            if o_id == sgnode["id"]:
                continue  # não deve acontecer
            inputs[entry["name"]] = [f"top{o_id}" if False else f"top{top_nodes.index(next(m for m in top_nodes if m['id']==o_id))+1}", o_slot]
        wm = widget_map(n)
        for k, v in wm.items():
            if k not in inputs and k != "upload":
                inputs[k] = v
        api[new_id] = {"class_type": cls, "inputs": inputs}

# refs de topo nos inputs internos: corrigir ids para o padrão topo<i>
def fix_refs(node):
    for k, v in list(node["inputs"].items()):
        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and v[0].isdigit():
            # veio do boundary -> id do topo numérico
            idx = next((i for i, n in enumerate(top_nodes) if str(n["id"]) == v[0]), None)
            if idx is not None:
                node["inputs"][k] = [f"top{idx+1}", v[1]]
for node in api.values():
    fix_refs(node)

# SaveImage ref interna: inner_out_id ok; mas se a origem interna era boundary... não pode ser.
final = {k: {"class_type": v["class_type"], "inputs": v["inputs"]} for k, v in api.items()}

json.dump(final, open(args.dst, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"OK -> {args.dst} ({len(final)} nós)")
for n, v in final.items():
    print(f"  {n}: {v['class_type']} inputs={list(v['inputs'].keys())}")
for r in report:
    print(r)
