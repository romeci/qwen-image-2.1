# Cria ATALHOS padrao p/ abrir o app sem terminal e sem instalar nada:
#   - Area de Trabalho: "Qwen Image 2.1.lnk"
#   - Menu Iniciar:     "Qwen Image 2.1.lnk"
# Ambos escondem o console (powershell -WindowStyle Hidden -> start_app.ps1 ->
# tarefa interativa -> run_hidden.vbs -> electron). ASCII puro (regra do repo).
$ErrorActionPreference = "Stop"
$W = New-Object -ComObject WScript.Shell
$target = "powershell.exe"
$argStr = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "Z:\qwen-image-2.1\scripts\start_app.ps1"'
$icon = "Z:\qwen-image-2.1\node_modules\electron\dist\electron.exe,0"
$wd = "Z:\qwen-image-2.1"

function Make-Shortcut([string]$dir, [string]$name) {
  $l = $W.CreateShortcut((Join-Path $dir $name))
  $l.TargetPath = $target
  $l.Arguments = $argStr
  $l.WorkingDirectory = $wd
  $l.IconLocation = $icon
  $l.Description = "Qwen Image 2.1 Desktop (gerador de imagens local)"
  $l.Save()
}

$desktop = [Environment]::GetFolderPath("Desktop")
$startMenu = [Environment]::GetFolderPath("Programs")
Make-Shortcut $desktop "Qwen Image 2.1.lnk"
Make-Shortcut $startMenu "Qwen Image 2.1.lnk"
Write-Host ("ATALHOS_OK desktop=" + $desktop)
Write-Host ("ATALHOS_OK inicio=" + $startMenu)
