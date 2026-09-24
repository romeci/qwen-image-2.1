# Abre o app pelo EXECUTAVEL empacotado (win-unpacked) no desktop interativo,
# via tarefa agendada (mesma mecanica do start_app.ps1) + guarda de duplicata.
$ErrorActionPreference = "Continue"
$T = "HermesQwenApp"
$EXE = "Z:\qwen-image-2.1\app\dist\win-unpacked\Qwen Image 2.1.exe"

if (!(Test-Path $EXE)) { throw "exe nao encontrado: $EXE" }

$mine = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "Z:\qwen-image-2.1\*" }
if ($mine) { Write-Host ("APP_JA_ABERTO pid=" + (($mine | Select-Object -First 1).Id)); exit 0 }

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"Z:\qwen-image-2.1\scripts\run_hidden_exe.vbs"' -WorkingDirectory "Z:\qwen-image-2.1"
$principal = New-ScheduledTaskPrincipal -UserId "desktop\dev" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $T -Action $action -Principal $principal -Force | Out-Null
Write-Host "tarefa '$T' registrada (exe) - disparando..."

Remove-Item "Z:\qwen-image-2.1\boot.log" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $T
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path "Z:\qwen-image-2.1\boot.log") {
    $b = Get-Content "Z:\qwen-image-2.1\boot.log" -Raw -ErrorAction SilentlyContinue
    if ($b -match "renderer carregado") { Write-Host "APP_OK (exe): janela criada + renderer carregado"; exit 0 }
  }
}
Write-Host "APP_NAO_SUBIU em 40s (veja boot.log/app.log)"; exit 1
