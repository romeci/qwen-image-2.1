# Confere processos do app SEM $_ inline (o ssh come o char).
Write-Host "=== processos !===" 
Get-Process -Name "electron","Qwen Image 2.1" -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, Path | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "=== boot.log ==="
Get-Content "Z:\qwen-image-2.1\boot.log" -ErrorAction SilentlyContinue
Write-Host "=== app.log (tail 5) ==="
Get-Content "Z:\qwen-image-2.1\app.log" -Tail 5 -ErrorAction SilentlyContinue
