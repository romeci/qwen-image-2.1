#!/usr/bin/env python3
"""Valida os workflows API contra /object_info do ComfyUI de pé.

  python scripts/validate_workflows.py
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8188"


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return json.loads(r.read().decode())


def unwrap(exp):
    """[ ['opt1',...] , {meta} ]  ou  ['INT', {meta}]  ou  ['COMFY_AUTOGROW_V3', {...}]"""
    if isinstance(exp, list) and len(exp) == 2 and isinstance(exp[1], dict):
        return exp[0], exp[1]
    if isinstance(exp, list) and len(exp) == 1:
        return exp[0], {}
    return exp, {}


def type_ok(expected, value):
    if isinstance(value, list):  # ref [node, slot]
        return True
    base, meta = unwrap(expected)
    if meta.get("template"):  # autogrow: checado no bloco de knowns
        return True
    if isinstance(base, list):  # combo
        if not base or not all(isinstance(x, (str, int, float)) for x in base):
            return True
        return value in base
    if expected == "INT":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "FLOAT":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "STRING":
        return isinstance(value, str)
    if expected == "BOOLEAN":
        return isinstance(value, bool)
    return True


def check(wf_path, info):
    wf = json.load(open(wf_path, encoding="utf-8"))
    errs, warns = [], []
    ids = set(wf.keys())
    for nid, node in wf.items():
        cls = node["class_type"]
        if cls not in info:
            errs.append(f"{nid} [{cls}]: classe desconhecida no servidor")
            continue
        spec = info[cls]["input"]
        required = spec.get("required", {})
        optional = spec.get("optional", {})
        known = set(required) | set(optional)
        for k, exp in {**required, **optional}.items():
            base, meta = unwrap(exp)
            if isinstance(meta, dict) and meta.get("template"):
                names = meta["template"].get("names", [])
                for n in names:
                    known.add(f"{k}.{n}")
        for k, v in node["inputs"].items():
            if k not in known:
                warns.append(f"{nid} [{cls}]: input '{k}' não existe — remover")
                continue
            exp = required.get(k, optional.get(k))
            if not type_ok(exp, v):
                base, meta = unwrap(exp)
                if isinstance(meta, dict) and meta.get("image_upload"):
                    warns.append(f"{nid} [{cls}].{k}: arquivo {v!r} ainda não está no input/ (copiado em runtime)")
                else:
                    errs.append(f"{nid} [{cls}].{k}: valor {v!r} incompatível com {exp}")
        for k, exp in required.items():
            if k in node["inputs"]:
                continue
            base, meta = unwrap(exp)
            if isinstance(meta, dict) and meta.get("template"):
                continue  # autogrow min:0 — aceito sem a chave (confirmado no POST real)
            errs.append(f"{nid} [{cls}]: falta o input obrigatório '{k}'")
        for k, v in node["inputs"].items():
            if isinstance(v, list) and len(v) == 2:
                tgt = v[0]
                if tgt not in ids:
                    errs.append(f"{nid} [{cls}].{k}: referência para nó inexistente '{tgt}'")
                    continue
                tcls = wf[tgt]["class_type"]
                # slot de saída: só checa se a spec do alvo indicar (best-effort)
    return errs, warns


def main():
    try:
        info = get("/object_info")
    except Exception as e:
        sys.exit(f"ComfyUI offline ({e}) — suba o servidor antes de validar")
    fails = False
    for name in ("t2i_api.json", "edit_api.json"):
        p = os.path.join(ROOT, "workflows", name)
        errs, warns = check(p, info)
        print(f"\n=== {name} ===")
        for w in warns:
            print("  WARN:", w)
        for e in errs:
            print("  ERRO:", e)
        if not errs:
            print("  PASS" + (" (com warnings)" if warns else ""))
        else:
            fails = True
    # arquivos de modelo visíveis?
    for cls, key in (("UnetLoaderGGUF", "unet_name"), ("CLIPLoader", "clip_name"), ("VAELoader", "vae_name")):
        if cls in info:
            opts = info[cls]["input"].get("required", {}).get(key, [None])[0]
            if isinstance(opts, list):
                print(f"{cls}.{key}: {opts}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
