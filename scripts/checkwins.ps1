# Roda NA SESSAO 6 (desktop interativo) via tarefa - EnumWindows so ve a estacao propria.
# Lista TODAS as janelas visiveis (pid, classe, titulo) p/ detectar console/prompt indesejado.
$sig = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum3 {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int m);
  public static List<string> Visiveis() {
    var res = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      var tc = new StringBuilder(256); GetClassNameW(h, tc, 256);
      var tt = new StringBuilder(512); GetWindowTextW(h, tt, 512);
      var cls = tc.ToString();
      if (cls == "Progman" || cls == "Shell_TrayWnd" || cls == "WorkerW") return true;
      res.Add(pid + "|" + cls + "|" + tt.ToString());
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
Add-Type -TypeDefinition $sig
$lines = @("== janelas visiveis (pid|classe|titulo) ==")
foreach ($l in [WinEnum3]::Visiveis()) { $lines += $l }
[System.IO.File]::WriteAllLines("Z:\qwen-image-2.1\checkwins.txt", $lines)
