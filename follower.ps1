# ===========================================================================
# Wallpaper Engine 原生壁纸 · Folia 模组 · 跟随器（we-follow.exe 的回退实现）
# 版权所有 (C) 2026 NaLuna。保留所有权利。
# 未经作者书面许可，禁止转载、二次分发、收费、修改后发布或去除署名。
# 完整条款见同目录的「使用条款.txt」。
# ===========================================================================

# 跟随器：把 Wallpaper Engine 的 -playInWindow 窗口压在宿主窗口正下方，跟随移动/缩放。
# 输入（环境变量）：
#   FOLIA_WE_MODE       find | follow（默认 follow）
#   FOLIA_WE_TITLE      WE 窗口标题
#   FOLIA_HOST_HWND     宿主窗口句柄（十进制字符串）
# find 模式：打印 {"found":true,"hwnd":123} 后退出；follow 模式：循环跟随，宿主或壁纸窗口消失时退出。
$ErrorActionPreference = 'Stop'

$mode = $env:FOLIA_WE_MODE
if ([string]::IsNullOrWhiteSpace($mode)) { $mode = 'follow' }
$title = $env:FOLIA_WE_TITLE
$hostRaw = $env:FOLIA_HOST_HWND
if ([string]::IsNullOrWhiteSpace($title)) { throw 'FOLIA_WE_TITLE is empty' }
if ($mode -eq 'follow' -and [string]::IsNullOrWhiteSpace($hostRaw)) { throw 'FOLIA_HOST_HWND is empty' }

$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;

public sealed class WeFollow
{
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", SetLastError = true)] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x00000080L;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_NOSENDCHANGING = 0x0400;
    const int SW_HIDE = 0;
    const int SW_SHOWNA = 8;

    static string Title(IntPtr hWnd)
    {
        var text = new StringBuilder(512);
        GetWindowTextW(hWnd, text, 512);
        return text.ToString();
    }

    static IntPtr FindByTitle(string title)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            if (found != IntPtr.Zero) return true;
            if (Title(hWnd) == title) { found = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static int Find(string title)
    {
        IntPtr hWnd = FindByTitle(title);
        if (hWnd == IntPtr.Zero)
        {
            Console.WriteLine("{\"found\":false}");
            return 1;
        }
        Console.WriteLine("{\"found\":true,\"hwnd\":" + hWnd.ToInt64() + "}");
        return 0;
    }

    public static int Follow(string title, string hostRaw)
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }

        ulong raw;
        if (!ulong.TryParse(hostRaw, out raw) || raw == 0) return 2;
        IntPtr host = new IntPtr(unchecked((long)raw));

        IntPtr we = IntPtr.Zero;

        while (true)
        {
            if (!IsWindow(host)) return 0;

            // 壁纸窗口被换掉/重建时重新找，别直接退出。
            if (!IsWindow(we))
            {
                we = FindByTitle(title);
                if (we == IntPtr.Zero) { Thread.Sleep(200); continue; }
                try
                {
                    IntPtr ex = GetWindowLongPtr(we, GWL_EXSTYLE);
                    SetWindowLongPtr(we, GWL_EXSTYLE, new IntPtr(ex.ToInt64() | WS_EX_TOOLWINDOW));
                }
                catch { }
            }

            // 用客户区矩形（可见内容区），避开 Windows 那圈不可见的缩放边框，
            // 否则壁纸会贴到窗口外框上，比播放器大一圈。
            RECT cr;
            if (!GetClientRect(host, out cr)) { Thread.Sleep(100); continue; }
            POINT tl = new POINT(); tl.X = cr.Left; tl.Y = cr.Top;
            POINT br = new POINT(); br.X = cr.Right; br.Y = cr.Bottom;
            if (!ClientToScreen(host, ref tl) || !ClientToScreen(host, ref br)) { Thread.Sleep(100); continue; }
            int x = tl.X;
            int y = tl.Y;
            int w = br.X - tl.X;
            int h = br.Y - tl.Y;

            if (IsIconic(host) || w <= 0 || h <= 0)
            {
                ShowWindow(we, SW_HIDE);
            }
            else
            {
                ShowWindow(we, SW_SHOWNA);
                // 每次都重申位置和 Z 序（压在宿主正下方），防止 WE 把自己的窗口抬到前台。
                SetWindowPos(we, host, x, y, w, h, SWP_NOACTIVATE | SWP_NOSENDCHANGING);
            }
            Thread.Sleep(33);
        }
    }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

if ($mode -eq 'find') {
    [WeFollow]::Find($title) | Out-Null
} else {
    [WeFollow]::Follow($title, $hostRaw) | Out-Null
}
