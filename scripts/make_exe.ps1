# Rebuilda o executavel do app em app\dist sempre que o codigo mudar.
# - win-unpacked: abre na hora (exe + dlls de lado)
# - portable: unico arquivo QwenImage21-Desktop.exe p/ copiar pra onde quiser
# CONVENCAO: .ps1 deste app = ASCII puro.
$ErrorActionPreference = "Continue" # npm warn no stderr nao pode matar o script
cd Z:\qwen-image-2.1

# electron-builder so quando ainda nao existe (npm install repetido e lento)
if (!(Test-Path ".\node_modules\electron-builder")) {
  Write-Host "instalando electron-builder (uma vez)..."
  cmd /c "npm install --no-audit --no-fund"
  if ($LASTEXITCODE -ne 0) { throw "npm install falhou ($LASTEXITCODE)" }
}

# fecha o app antes de sobrescrever o exe (arquivo travado = build falha)
Get-Process electron, "Qwen Image 2.1" -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "Z:\qwen-image-2.1\*" } |
  ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

npx electron-builder --win portable --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder (portable) falhou ($LASTEXITCODE)" }
npx electron-builder --dir --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder (dir) falhou ($LASTEXITCODE)" }

Write-Host ""
Write-Host ("unpacked: " + (Test-Path ".\app\dist\win-unpacked\Qwen Image 2.1.exe"))
Write-Host ("portable: " + (Test-Path ".\app\dist\QwenImage21-Desktop.exe"))
Get-ChildItem .\app\dist | Select-Object Name, @{n="MB";e={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
