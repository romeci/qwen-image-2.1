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

# tarefa com LogonType Interactive = janela no DESKTOP do usuario logado (sem XML)
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d Z:\qwen-image-2.1 && npm start > Z:\qwen-image-2.1\app.log 2>&1" -WorkingDirectory "Z:\qwen-image-2.1"
$principal = New-ScheduledTaskPrincipal -UserId "desktop\dev" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $T -Action $action -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $T
Write-Host "tarefa '$T' disparada - aguardando janela..."

for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 2
  $w = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  if ($w) {
    Write-Host ("JANELA_OK pid=" + $w.Id + " titulo='" + $w.MainWindowTitle + "' handle=" + $w.MainWindowHandle)
    exit 0
  }
}
Write-Host "JANELA_NAO_ENCONTRADA em 30s"
exit 1
