#!/usr/bin/env python3
"""Diagnóstico: por que o ComfyUI-GGUF rejeita o gguf (arch 'qwen_image21')."""
import glob, json, os, re, sys, urllib.request

ROOT = r"Z:\qwen-image-2.1"
VENV_SP = os.path.join(ROOT, "comfy", "venv", "Lib", "site-packages")
CUSTOM = os.path.join(ROOT, "comfy", "ComfyUI", "custom_nodes", "ComfyUI-GGUF")
GGUF = os.path.join(ROOT, "models", "diffusion_models", "qwen-image-2.1-UC-Q8_0.gguf")

ERR = "Unexpected architecture type"

# 1) achar quem lança o erro e como mapeia arquiteturas
print("== procura do erro ==")
pyfiles = glob.glob(os.path.join(VENV_SP, "**", "*.py"), recursive=True) + \
          glob.glob(os.path.join(CUSTOM, "**", "*.py"), recursive=True)
hits = []
for f in pyfiles:
    try:
        txt = open(f, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    if ERR in txt:
        hits.append(f)
for f in hits:
    print(" ARQUIVO:", f)
    for i, line in enumerate(open(f, encoding="utf-8", errors="ignore"), 1):
        if ERR in line or "arch" in line.lower() and ("qwen" in line.lower() or "==" in line or "in " in line):
            print(f"   {i}: {line.rstrip()[:200]}")

# 2) listar arqs que citam qwen nesses arquivos
print("== menções a qwen ==")
for f in hits:
    for i, line in enumerate(open(f, encoding="utf-8", errors="ignore"), 1):
        if "qwen" in line.lower():
            print(f"   {os.path.basename(f)}:{i}: {line.rstrip()[:200]}")

# 3) arch real gravado no gguf (primeiros KB do arquivo: metadados)
print("== header do gguf ==")
with open(GGUF, "rb") as fh:
    head = fh.read(8192)
txt = re.sub(rb"[^\x20-\x7e]", b" ", head).decode("ascii", "ignore")
m = re.findall(r"general\.architecture\s*\S+\s*([a-z0-9_]+)", txt)
print("  arch candidatos:", m[:5])
print("  trecho:", txt[:400])

# 4) versões
print("== versões ==")
try:
    import comfyui_gguf  # type: ignore
    print("  comfyui_gguf:", getattr(comfyui_gguf, "__file__", "?"))
except Exception as e:
    print("  import comfyui_gguf falhou:", e)
print("  custom_nodes tree:", os.listdir(CUSTOM))
git = os.path.join(CUSTOM, ".git")
if os.path.isdir(git):
    os.system(f'git -C "{CUSTOM}" log -1 --format="  gguf-node commit %h %s"')

# 5) object_info do UNETLoader (suporta .gguf nativo?)
print("== UNETLoader options ==")
try:
    with urllib.request.urlopen("http://127.0.0.1:8188/object_info/UNETLoader", timeout=30) as r:
        d = json.loads(r.read().decode())
    opts = d["UNETLoader"]["input"]["required"]["unet_name"][0]
    print("  ", opts)
except Exception as e:
    print("  falhou:", e)

# 6) node nativo de gguf?
try:
    with urllib.request.urlopen("http://127.0.0.1:8188/object_info", timeout=60) as r:
        info = json.loads(r.read().decode())
    gguf_nodes = [k for k in info if "gguf" in k.lower()]
    print("== nós com gguf no nome:", gguf_nodes)
    for k in gguf_nodes:
        try:
            o = info[k]["input"]["required"].get("unet_name", [None])[0]
            if isinstance(o, list):
                print(f"   {k}: {o}")
        except Exception:
            pass
except Exception as e:
    print("object_info falhou:", e)
