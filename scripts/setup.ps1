# Setup do backend ComfyUI para Qwen-Image-2.1 (rodar UMA vez)
# powershell -NoProfile -ExecutionPolicy Bypass -File Z:\qwen-image-2.1\scripts\setup.ps1
$ErrorActionPreference = "Stop"
$ROOT = "Z:\qwen-image-2.1"
$COMFY = "$ROOT\comfy"
$VENV = "$COMFY\venv"
$LOG = "$ROOT\setup.log"

function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m"; Write-Host $line; Add-Content -Path $LOG -Value $line }

Log "=== setup iniciado ==="

# 0) sanitiza o PATH: entradas quebradas (ex.: Cua driver, junction não confiável)
#    derrubam o pip com [WinError 448] "ponto de montagem não confiável"
$cleanPath = ($env:PATH -split ';' | Where-Object { $_ -and $_ -notmatch '(?i)cua' }) -join ';'
$env:PATH = $cleanPath
[Environment]::SetEnvironmentVariable("PATH", $cleanPath, "Process")
Log "PATH sanitizado (entradas removidas: $((($env:PATH -split ';').Count)))"

# 1) dirs + mover o GGUf local para o lugar correto
New-Item -ItemType Directory -Force -Path "$ROOT\models\diffusion_models", "$ROOT\models\text_encoders", "$ROOT\models\vae", "$ROOT\outputs", "$ROOT\comfy" | Out-Null
$gguf = Get-ChildItem -Path $ROOT -Recurse -Depth 3 -Filter "*.gguf" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notlike "*\models\*" -and $_.FullName -notlike "*\comfy\*" } | Select-Object -First 1
if ($gguf) {
  $dest = "$ROOT\models\diffusion_models\$($gguf.Name)"
  Log "movendo GGUF: $($gguf.FullName) -> $dest"
  Move-Item -LiteralPath $gguf.FullName -Destination $dest -Force
} else {
  $check = Get-ChildItem "$ROOT\models\diffusion_models" -Filter *.gguf -ErrorAction SilentlyContinue
  if (-not $check) { Write-Host "AVISO: nenhum .gguf encontrado"; Log "AVISO: nenhum .gguf encontrado" }
}

# 2) venv
if (-not (Test-Path "$VENV\Scripts\python.exe")) { Log "criando venv"; python -m venv $VENV }
$PY = "$VENV\Scripts\python.exe"
& $PY -m pip install --upgrade pip --quiet | Out-Null

# 3) torch CUDA (Windows: PyPI = CPU; SEMPRE usar o index da NVIDIA)
Log "instalando torch+torchvision+torchaudio (cu128)..."
& $PY -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 2>&1 | Tee-Object -FilePath $LOG -Append | Out-Null
if ($LASTEXITCODE -ne 0) { throw "falha ao instalar torch" }
Log "torch OK: $(& $PY -c 'import torch; print(torch.__version__, torch.cuda.is_available())')"

# 4) ComfyUI
if (-not (Test-Path "$COMFY\ComfyUI\main.py")) {
  Log "clonando ComfyUI..."
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$COMFY\ComfyUI"
}
Log "instalando requirements do ComfyUI..."
& $PY -m pip install -r "$COMFY\ComfyUI\requirements.txt" 2>&1 | Tee-Object -FilePath $LOG -Append | Out-Null
if ($LASTEXITCODE -ne 0) { throw "falha nos requirements do ComfyUI" }

# 5) ComfyUI-GGUF (loader do .gguf)
if (-not (Test-Path "$COMFY\ComfyUI\custom_nodes\ComfyUI-GGUF")) {
  Log "clonando ComfyUI-GGUF..."
  git clone --depth 1 https://github.com/city96/ComfyUI-GGUF "$COMFY\ComfyUI\custom_nodes\ComfyUI-GGUF"
}
# 5b) PATCH obrigatório: o arch do seu gguf e 'qwen_image21' e o node so aceita 'qwen_image'
#     (refazer se o ComfyUI-GGUF for atualizado por git pull)
$loader = "$COMFY\ComfyUI\custom_nodes\ComfyUI-GGUF\loader.py"
$src = Get-Content -Raw -LiteralPath $loader
if ($src -notmatch 'qwen_image21') {
  $src = $src -replace '"lumina2", "qwen_image"', '"lumina2", "qwen_image", "qwen_image21"'
  Set-Content -LiteralPath $loader -Value $src -NoNewline
  Log "loader.py patchado (IMG_ARCH_LIST += qwen_image21)"
} else {
  Log "loader.py ja patchado"
}
& $PY -m pip install -r "$COMFY\ComfyUI\custom_nodes\ComfyUI-GGUF\requirements.txt" 2>&1 | Tee-Object -FilePath $LOG -Append | Out-Null

# 6) mapa de pastas de modelos (models/ na raiz do app)
Copy-Item "$ROOT\extra_model_paths.yaml" "$COMFY\ComfyUI\extra_model_paths.yaml" -Force
Log "extra_model_paths.yaml copiado"

# 7) downloads que faltam: text encoder (9.35GB) + VAE (676MB)
$te = "$ROOT\models\text_encoders\qwen3vl_8b_int8_convrot.safetensors"
if (-not (Test-Path $te)) {
  Log "baixando text encoder qwen3vl_8b_int8_convrot (9.35 GB)..."
  curl.exe -L --retry 3 -C - --retry-delay 5 -o $te "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors"
  if ($LASTEXITCODE -ne 0) { throw "falha no download do text encoder" }
}
$vae = "$ROOT\models\vae\qwen_image_2.1_vae_bf16.safetensors"
if (-not (Test-Path $vae)) {
  Log "baixando VAE qwen_image_2.1_vae_bf16 (676 MB)..."
  curl.exe -L --retry 3 -C - --retry-delay 5 -o $vae "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors"
  if ($LASTEXITCODE -ne 0) { throw "falha no download do VAE" }
}

Log "=== setup concluído ==="
Write-Host "SETUP_OK"
