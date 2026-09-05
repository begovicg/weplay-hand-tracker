# Persistent window-enumeration server for the HUD overlay — spawned ONCE
# for the whole HUD session (see src/windowFinder.js) and kept alive on its
# own stdin/stdout pipe, instead of the original design's fresh
# powershell.exe + Add-Type C# compile on every single poll tick.
#
# That original design was measured at 500-800ms of real CPU work (mostly
# Roslyn compiling the P/Invoke declarations below from scratch, plus
# PowerShell's own process-startup cost) EVERY 2.5 seconds, for as long as
# the HUD ran — a real, recurring CPU spike, and the actual cause of a
# reported slowdown (mouse-scroll stutter) while the HUD was on. Add-Type
# here still runs once, at startup; every request after that is answered
# by an already-compiled, already-running process in a few milliseconds.
#
# Protocol: one line on stdin ("GO") triggers one enumeration; the reply is
# one line of compact JSON on stdout. "exit" (or stdin simply closing, e.g.
# because the parent Node process died) ends the loop.

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WeplayHudWin32 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp

function Get-WeplayTableWindows {
  $results = New-Object System.Collections.Generic.List[object]
  $callback = {
    param($hWnd, $lParam)
    if ([WeplayHudWin32]::IsWindowVisible($hWnd)) {
      $len = [WeplayHudWin32]::GetWindowTextLength($hWnd)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [WeplayHudWin32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        $title = $sb.ToString()
        if ($title -like "*Hold*em*") {
          $rect = New-Object WeplayHudWin32+RECT
          [WeplayHudWin32]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
          $results.Add([PSCustomObject]@{
            title = $title
            x = $rect.Left
            y = $rect.Top
            width = ($rect.Right - $rect.Left)
            height = ($rect.Bottom - $rect.Top)
          })
        }
      }
    }
    return $true
  }
  $delegate = [WeplayHudWin32+EnumWindowsProc]$callback
  [WeplayHudWin32]::EnumWindows($delegate, [IntPtr]::Zero) | Out-Null
  return $results
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }

  $results = Get-WeplayTableWindows
  if ($results.Count -eq 0) {
    $json = '[]'
  } else {
    # -Compress keeps the whole reply on one line (the Node side reads a
    # single line per response) and ConvertTo-Json collapses a one-element
    # array to a bare object, which the extra wrap below undoes — same
    # fix as the original one-shot script used.
    $json = ConvertTo-Json -InputObject $results -Depth 3 -Compress
    if ($results.Count -eq 1) { $json = "[$json]" }
  }
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}
