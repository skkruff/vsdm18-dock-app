# Keyboard helper for MSFS Switchboard (plugin/keys.js). Started once by the plugin; reads one
# command per line on stdin: "k <scan> <ext 0|1> <up 0|1>" sends a key by scancode (SendInput),
# "s <ms>" sleeps, "f" brings MSFS to the front if it is not already, "p" answers "pong".
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class SwKeys {
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  public static uint Key(ushort scan, bool ext, bool up) {
    INPUT i = new INPUT();
    i.type = 1;
    i.u.ki.wScan = scan;
    i.u.ki.dwFlags = 0x0008u | (ext ? 0x0001u : 0u) | (up ? 0x0002u : 0u);
    return SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Focus() {
    foreach (string name in new string[] { "FlightSimulator2024", "FlightSimulator" }) {
      foreach (Process p in Process.GetProcessesByName(name)) {
        IntPtr h = p.MainWindowHandle;
        if (h == IntPtr.Zero) continue;
        if (GetForegroundWindow() == h) return "already";
        if (IsIconic(h)) ShowWindow(h, 9);
        // Windows only lets the foreground app hand focus over; a tap of Alt counts as input from us.
        Key(0x38, false, false); Key(0x38, false, true);
        return SetForegroundWindow(h) ? "focused" : "refused";
      }
    }
    return "nosim";
  }
}
"@
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'k' { [void][SwKeys]::Key([uint16]$p[1], $p[2] -eq '1', $p[3] -eq '1') }
      's' { Start-Sleep -Milliseconds ([int]$p[1]) }
      'f' { [Console]::Out.WriteLine('focus ' + [SwKeys]::Focus()); Start-Sleep -Milliseconds 60 }
      'p' { [Console]::Out.WriteLine('pong') }
    }
  } catch { [Console]::Out.WriteLine('error ' + $_.Exception.Message) }
}
