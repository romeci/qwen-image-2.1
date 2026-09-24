# Reinicia o app Qwen Image 2.1: mata SO o electron DESTE app e reabre pela tarefa interativa.
# Nunca filtra por electron.exe em geral (o Hermes tambem e electron).
$mine = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'Z:\qwen-image-2.1\node_modules\electron\*' }
foreach ($p in $mine) {
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 4
$left = (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'Z:\qwen-image-2.1\node_modules\electron\*' } | Measure-Object).Count
Write-Host ("electron_nosso_restantes=" + $left)
powershell -NoProfile -ExecutionPolicy Bypass -File Z:\qwen-image-2.1\scripts\start_app.ps1
