# Encerra só o ComfyUI desta aplicação (python rodando main.py na porta 8188)
$killed = @()
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*main.py*' -and $_.CommandLine -like '*8188*') {
    $killed += $_.ProcessId
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
Write-Host ("KILLED: " + $(if ($killed) { $killed -join ',' } else { 'nenhum' }))
