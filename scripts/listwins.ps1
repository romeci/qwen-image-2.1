$sig = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum {
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
      var t = sb.ToString();
      if (t.Length > 0 || IsWindowVisible(h))
        res.Add(pid + "|vis=" + (IsWindowVisible(h) ? 1 : 0) + "|h=" + h + "|" + t);
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
Add-Type -TypeDefinition $sig
$pids = (Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Write-Host ("electron pids: " + ($pids -join ","))
[WinEnum]::List() | Where-Object {
  $line = $_
  ($pids | ForEach-Object { $line.StartsWith("$_|") }) -contains $true
} | ForEach-Object { Write-Host ("WIN: " + $_) }
