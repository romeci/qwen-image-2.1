#!/usr/bin/env python3
r"""CLI do Qwen-Image-2.1 — mesma lógica do app Electron (por isso serve de teste E2E).

Requer o servidor ComfyUI de pé (o app Electron sobe sozinho, ou manualmente:
  comfy\venv\Scripts\python.exe comfy\ComfyUI\main.py --listen 127.0.0.1 --port 8188 --output-directory outputs
)
Uso:
  python scripts/generate.py --mode t2i --prompt "um gato astronauta" --width 1024 --height 1024
  python scripts/generate.py --mode edit --prompt "fundo sunset" --images foto1.png foto2.png
"""
import argparse, json, os, sys, time, urllib.request, urllib.error, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "http://127.0.0.1:8188"
WF_DIR = os.path.join(ROOT, "workflows")
OUT_DIR = os.path.join(ROOT, "outputs")
INPUT_DIR = os.path.join(ROOT, "comfy", "ComfyUI", "input")


def req(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code} em {path}:\n{body[:4000]}")


def patch_workflow(wf, o):
    loaders = [k for k, n in wf.items() if n["class_type"] == "LoadImage"]
    te_of = lambda: next((n for n in wf.values() if n["class_type"] == "TextEncodeQwenImage21"), None)
    while len(loaders) < len(o.images):
        wid = f"li_{len(loaders)+1}"
        wf[wid] = {"class_type": "LoadImage", "inputs": {"image": ""}}
        loaders.append(wid)
        te = te_of()
        if te:
            te.inputs[f"images.image_{len(loaders)}"] = [wid, 0]
    # atribui imagem a cada LoadImage; os SEM imagem são descartados (nó + refs)
    for idx, wid in enumerate(list(loaders)):
        if idx < len(o.images):
            wf[wid]["inputs"]["image"] = o.images[idx]
            continue
        del wf[wid]
        for n in wf.values():
            if n["class_type"] != "TextEncodeQwenImage21":
                continue
            for k in [k for k, v in n["inputs"].items() if isinstance(v, list) and v and v[0] == wid]:
                del n["inputs"][k]
    for node in wf.values():
        c = node["class_type"]
        inp = node["inputs"]
        if c == "TextEncodeQwenImage21":
            inp["prompt"] = o.prompt
            inp["negative_prompt"] = o.negative or ""
        elif c == "KSampler":
            inp["seed"] = o.seed
            inp["steps"] = o.steps
            inp["cfg"] = o.cfg
            inp["sampler_name"] = o.sampler
            inp["scheduler"] = o.scheduler
        elif c == "EmptyLatentImage":
            inp["width"], inp["height"] = o.width, o.height
        elif c == "ComfySwitchNode":
            inp["switch"] = bool(o.custom_size)
        elif c == "SaveImage":
            inp["filename_prefix"] = "Qwen_edit" if o.mode == "edit" else "Qwen_t2i"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["t2i", "edit"], default="t2i")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--negative", default="")
    ap.add_argument("--steps", type=int, default=25)
    ap.add_argument("--cfg", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--sampler", default="euler")
    ap.add_argument("--scheduler", default="simple")
    ap.add_argument("--images", nargs="*", default=[])
    ap.add_argument("--custom-size", action="store_true")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--validate-only", action="store_true", help="só monta e imprime o prompt JSON")
    o = ap.parse_args()
    if o.seed is None:
        o.seed = int(time.time() * 1000) % (2 ** 48)

    wf_path = os.path.join(WF_DIR, "edit_api.json" if o.mode == "edit" else "t2i_api.json")
    with open(wf_path, encoding="utf-8") as f:
        wf = json.load(f)

    if o.mode == "edit":
        if not o.images:
            sys.exit("edição exige --images")
        os.makedirs(INPUT_DIR, exist_ok=True)
        stamp = int(time.time())
        staged = []
        for i, src in enumerate(o.images):
            ext = os.path.splitext(src)[1] or ".png"
            name = f"qapp_{stamp}_{i}{ext}"
            with open(src, "rb") as fi, open(os.path.join(INPUT_DIR, name), "wb") as fo:
                fo.write(fi.read())
            staged.append(name)
        o.images = staged
    else:
        o.images = []

    patch_workflow(wf, o)
    if o.validate_only:
        print(json.dumps(wf, indent=2, ensure_ascii=False))
        return

    try:
        req("GET", "/system_stats")
    except Exception:
        sys.exit("servidor ComfyUI offline — inicie pelo app ou manualmente (veja o docstring)")

    client = f"cli_{uuid.uuid4().hex[:8]}"
    resp = req("POST", "/prompt", {"prompt": wf, "client_id": client})
    pid = resp.get("prompt_id")
    if not pid:
        sys.exit("ComfyUI recusou o prompt: " + json.dumps(resp)[:800])
    print(f"prompt_id={pid} — aguardando (o 1º carrega o modelo)...")
    t0 = time.time()
    while True:
        if time.time() - t0 > o.timeout:
            sys.exit("timeout")
        hist = req("GET", f"/history/{pid}")
        entry = hist.get(pid)
        if entry and entry.get("status", {}).get("status_str") in ("success", "error", "failure"):
            st = entry["status"]
            if st["status_str"] != "success":
                for m in st.get("messages", []):
                    if m[0] == "execution_error":
                        sys.exit("ERRO: " + json.dumps(m[1])[:1000])
                sys.exit("execução falhou")
            files = []
            for out in entry.get("outputs", {}).values():
                for im in out.get("images", []):
                    p = os.path.join(OUT_DIR, im.get("subfolder", ""), im["filename"])
                    files.append(p)
            print(f"OK em {time.time()-t0:.0f}s")
            for p in files:
                print(p)
            return
        time.sleep(2)


if __name__ == "__main__":
    main()
