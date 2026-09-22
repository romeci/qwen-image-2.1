# Fecha a janela do app como se o usuario clicasse no X (WM_CLOSE).
# Roda via tarefa (sessao 6) - window-all-closed -> stopServer -> VRAM liberada.
$sig = @"
using System;
using System.Runtime.InteropServices;
public class WmClose {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static int ClosePids(int[] pids) {
    int n = 0;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      foreach (int ep in pids) {
        if ((uint)ep == pid && IsWindowVisible(h)) {
          PostMessage(h, 0x10, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE
          n++;
        }
      }
      return true;
    }, IntPtr.Zero);
    return n;
  }
}
"@
Add-Type -TypeDefinition $sig
$eps = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq 6 } | Select-Object -ExpandProperty Id)
if (-not $eps) { Write-Host "NENHUM electron na sessao 6"; exit 0 }
$n = [WmClose]::ClosePids($eps)
Write-Host ("WM_CLOSE enviado para " + $n + " janela(s) (pids: " + ($eps -join ",") + ")")
