# Roda NA SESSAO 6 (desktop interativo) via tarefa - EnumWindows so ve a estacao propria.
$sig = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum2 {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static List<string> List() {
    var res = new List<string>();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, 512);
      res.Add(pid + "|vis=" + (IsWindowVisible(h) ? 1 : 0) + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
Add-Type -TypeDefinition $sig
$eps = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$lines = @("pids: " + ($eps -join ","))
foreach ($l in [WinEnum2]::List()) {
  $pidv = 0
  try { $pidv = [int]($l -split '\|')[0] } catch {}
  if ($eps -contains $pidv) { $lines += $l }
}
if ($lines.Count -eq 1) { $lines += "NENHUMA janela do electron encontrada" }
[System.IO.File]::WriteAllLines("Z:\qwen-image-2.1\checkwins.txt", $lines)
