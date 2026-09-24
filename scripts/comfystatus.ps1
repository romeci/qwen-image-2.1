# Estado do servidor ComfyUI e do app empacotado (sem $_ inline).
Write-Host "porta 8188:"
(Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "python:"
(Get-Process python -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "memoria do exe principal (MB):"
Get-Process -Name "Qwen Image 2.1" -ErrorAction SilentlyContinue | Select-Object Id, @{n="MB";e={[math]::Round($_.WorkingSet64/1MB,0)}}, @{n="CPU_s";e={[math]::Round($_.CPU,0)}} | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "ui.log tail:"
Get-Content "Z:\qwen-image-2.1\logs\ui.log" -Tail 6 -ErrorAction SilentlyContinue
