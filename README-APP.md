# Qwen Image 2.1 — Desktop (Electron)

App desktop para gerar e editar imagens com **Qwen-Image-2.1** 100% local, usando o
GGUF que já está neste repositório (`qwen-image-2.1-UC-Q8_0.gguf`, Q8_0 ≈ 7,6 GB)
como backend **ComfyUI + ComfyUI-GGUF**.

- Fork de `QwenLM/Qwen-Image-2.1` → `romeci/qwen-image-2.1`
- Diretório: `Z:\qwen-image-2.1`
- GPU: NVIDIA (testado com RTX 3060 12 GB)

## O que baixa uma única vez (setup)

| Componente | Tamanho | Por quê |
|---|---|---|
| torch+torchvision+torchaudio (CUDA cu128) | ~3 GB | inferência GPU |
| ComfyUI + ComfyUI-GGUF | ~1 GB | servidor de inferência + loader `.gguf` |
| `qwen3vl_8b_int8_convrot.safetensors` | 9,35 GB | text encoder (obrigatório — o GGUF só contém o transformer) |
| `qwen_image_2.1_vae_bf16.safetensors` | 676 MB | VAE (obrigatório) |

O **modelo principal não baixa** — usa o `.gguf` local, movido pelo setup para
`models\diffusion_models\`.

## Setup (uma vez)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\qwen-image-2.1\scripts\setup.ps1
```

## Rodar o app (sem terminal)

**Atalho padrão** — duplo clique em **`Qwen Image 2.1`** na Área de Trabalho
(ou no Menu Iniciar). Abre sem console e sem instalar nada. Recriar atalhos:
`scripts\mkshortcut.ps1`.

<details><summary>Alternativa por terminal (ou abrir sem atalho)</summary>

```powershell
cd Z:\qwen-image-2.1
npm install   # uma vez (baixa o Electron)
npm start
```

> Nunca `npm start` via SSH — a janela nasce invisível (session 0). O atalho
> usa `start_app.ps1` → tarefa interativa → `run_hidden.vbs`.
</details>

O app sobe o ComfyUI automaticamente ao gerar (ou use ▶ Iniciar servidor).
Saída: `outputs\`. Logs: aba "Log" no rodapé.

## Uso em terminal (CLI)

```powershell
# subir o servidor (se não estiver pelo app):
Z:\qwen-image-2.1\comfy\venv\Scripts\python.exe Z:\qwen-image-2.1\comfy\ComfyUI\main.py --listen 127.0.0.1 --port 8188 --output-directory Z:\qwen-image-2.1\outputs

# gerar:
Z:\qwen-image-2.1\comfy\venv\Scripts\python.exe Z:\qwen-image-2.1\scripts\generate.py --mode t2i --prompt "um gato astronauta" --width 1024 --height 1024 --steps 25

# editar:
...\generate.py --mode edit --prompt "troque o fundo por uma praia ao pôr do sol" --images Z:\foto.png
```

## Estrutura

```
Z:\qwen-image-2.1\
├── main.js / preload.js / renderer\   app Electron
├── package.json                       npm start
├── workflows\                         t2i_api.json / edit_api.json (formato API ComfyUI)
├── scripts\
│   ├── setup.ps1                      setup único do backend
│   ├── generate.py                    CLI de geração/edição
│   ├── validate_workflows.py          valida workflows contra o servidor
│   └── ui2api.py                      converte templates UI oficiais → API
├── models\{diffusion_models,text_encoders,vae}   pesos locais
├── comfy\                             ComfyUI + venv (gerado pelo setup)
├── outputs\                           imagens geradas
└── extra_model_paths.yaml             aponta o ComfyUI para models\
```

## Workflows

`workflows/*.json` foram convertidos dos **templates oficiais** da Comfy-Org
(`image_qwen_image_2_1_t2i` / `image_qwen_image_2_1_image_edit`) com o transformer
trocado para `UnetLoaderGGUF` + o seu `.gguf` local. Regenerar:

```bash
python3 scripts/ui2api.py scripts/templates/image_qwen_image_2_1_t2i.json workflows/t2i_api.json \
  --unet-class UnetLoaderGGUF --unet-name qwen-image-2.1-UC-Q8_0.gguf
```

## VRAM (12 GB)

- Padrão 1 MP (1024²) cabe tranquilo; 2 MP (2048² nativo) é o máximo oficial e
  pode faltar VRAM com o Q8_0 — se der OOM, use 1 MP ou um quant menor
  (Q6_K/Q5_K_M do mesmo repo de quants).
- 1ª geração carrega o text encoder + transformer (vai à CPU/VRAM por etapas) —
  pode levar 1–3 min; depois fica rápido.

## Transparência (RGBA)

Ative "Modo RGBA" no app — o prompt é envolvido no formato oficial:
`This is an RGBA image with transparency. <seu prompt>. The image has alpha channel and the background is transparent.`

## Licensa

Código do modelo: [Qwen Research License](LICENSE). ComfyUI: GPL-3.0. App: MIT.
