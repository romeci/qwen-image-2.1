# Abre o app Qwen Image 2.1 no DESKTOP interativo (via tarefa agendada)
# (processos via ssh caem na session 0 e a janela fica invisivel)
# CONVENCAO: .ps1 deste app = ASCII puro. PowerShell 5.1 le UTF-8 sem BOM como
# ANSI; bytes como U+2014 viram aspas CP1252 (0x94) e quebram o parse do script.
$ErrorActionPreference = "Stop"
$T = "HermesQwenApp"

# mata SOTO os electron orfaos da session 0 (ssh) - os da sessao 6 (desktop do
# usuario, ex.: Hermes) nao sao tocados
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq 0 } | ForEach-Object {
  Write-Host "matando electron orfao session0: $($_.Id)"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# wscript oculto: cmd.exe direto abre o prompt do Windows junto (reclamacao do usuario)
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"Z:\qwen-image-2.1\scripts\run_hidden.vbs"' -WorkingDirectory "Z:\qwen-image-2.1"
$principal = New-ScheduledTaskPrincipal -UserId "desktop\dev" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $T -Action $action -Principal $principal -Force | Out-Null
Write-Host "tarefa '$T' registrada - disparando..."

# olho certo: boot.log escrito pelo proprio main.js (o ssh nao enxerga janelas da sessao 6)
Remove-Item "Z:\qwen-image-2.1\boot.log" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $T
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path "Z:\qwen-image-2.1\boot.log") {
    $b = Get-Content "Z:\qwen-image-2.1\boot.log" -Raw -ErrorAction SilentlyContinue
    if ($b -match "renderer carregado") { Write-Host "APP_OK: janela criada + renderer carregado"; exit 0 }
  }
}
Write-Host "APP_NAO_SUBIU em 40s (veja boot.log/app.log)"; exit 1
