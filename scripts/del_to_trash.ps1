# Envia arquivos para a LIXEIRA do Windows (recuperavel).
# Uso: powershell -File del_to_trash.ps1 -ListFile <arquivo com 1 caminho por linha>
param([string]$ListFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
$done = @()
foreach ($f in (Get-Content -LiteralPath $ListFile)) {
  if ([string]::IsNullOrWhiteSpace($f)) { continue }
  if (Test-Path -LiteralPath $f) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($f, 'OnlyErrorDialogs', 'SendToRecycleBin')
    $done += (Split-Path -Leaf $f)
  } else {
    $done += ('NAO_EXISTE:' + (Split-Path -Leaf $f))
  }
}
Write-Output ($done -join [Environment]::NewLine)
exit 0
