// ===========================================================================
// Wallpaper Engine 原生壁纸 · Folia 模组 · 窗口跟随器（编译为 we-follow.exe）
// 版权所有 (C) 2026 NaLuna。保留所有权利。
// 未经作者书面许可，禁止转载、二次分发、收费、修改后发布或去除署名。
// 完整条款见同目录的「使用条款.txt」。
// ===========================================================================

using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

class WeFollow
{
    delegate bool EnumProc(IntPtr h, IntPtr l);

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessageW(IntPtr h, uint msg, IntPtr w, IntPtr l);

    const int GWL_EXSTYLE = -20;
    const long WS_EX_TOOLWINDOW = 0x80;
    const uint SWP_NOACTIVATE = 0x10;
    const uint SWP_NOSENDCHANGING = 0x400;
    const int SW_HIDE = 0;
    const int SW_SHOWNA = 8;
    const uint WM_CLOSE = 0x0010;

    // =======================================================================
    // Core Audio（WASAPI）会话静音
    // 用途：壁纸的 project.json 若没有暴露音量属性，applyProperties 就无从下手
    //       （视频壁纸、以及大量场景壁纸都是如此）。这里直接静音 Wallpaper
    //       Engine 进程的音频会话，对任何壁纸都生效。
    // 注意：WE 用同一个进程播放桌面壁纸与播放器内的壁纸窗口，因此这一层静音
    //       会连同桌面壁纸一起静音。
    // =======================================================================
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

    enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(EDataFlow flow, int mask, out IMMDeviceCollection devices);
        int GetDefaultAudioEndpoint(EDataFlow flow, int role, out IMMDevice device);
        int GetDevice(string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        int GetCount(out int count);
        int Item(int index, out IMMDevice device);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr props, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        int OpenPropertyStore(int access, out IntPtr props);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr ctl);
        int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr vol);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
        int RegisterSessionNotification(IntPtr cb);
        int UnregisterSessionNotification(IntPtr cb);
        int RegisterDuckNotification(string id, IntPtr cb);
        int UnregisterDuckNotification(IntPtr cb);
    }

    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        int GetCount(out int count);
        int GetSession(int index, out IAudioSessionControl2 session);
    }

    [Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        int GetState(out int state);
        int GetDisplayName(out IntPtr name);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
        int GetIconPath(out IntPtr path);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
        int GetGroupingParam(out Guid param);
        int SetGroupingParam(ref Guid param, ref Guid ctx);
        int RegisterAudioSessionNotification(IntPtr cb);
        int UnregisterAudioSessionNotification(IntPtr cb);
        int GetSessionIdentifier(out IntPtr id);
        int GetSessionInstanceIdentifier(out IntPtr id);
        int GetProcessId(out int pid);
        int IsSystemSoundsSession();
        int SetDuckingPreference(bool optOut);
    }

    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        int SetMasterVolume(float level, ref Guid ctx);
        int GetMasterVolume(out float level);
        int SetMute(bool mute, ref Guid ctx);
        int GetMute(out bool mute);
    }

    // Wallpaper Engine 家族进程名（不含 .exe）
    static bool IsWeProcess(string name)
    {
        if (string.IsNullOrEmpty(name)) return false;
        string n = name.ToLowerInvariant();
        return n == "wallpaper64" || n == "wallpaper32"
            || n == "webwallpaper64" || n == "webwallpaper32"
            || n == "edgewallpaper64" || n == "edgewallpaper32";
    }

    // 返回受影响的会话数；负数表示枚举失败
    static int SetWeMute(bool mute)
    {
        int changed = 0;
        object enumObj = null;
        try
        {
            enumObj = new MMDeviceEnumerator();
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)enumObj;

            IMMDeviceCollection devices;
            // DEVICE_STATE_ACTIVE = 0x1
            if (enumerator.EnumAudioEndpoints(EDataFlow.eRender, 0x1, out devices) != 0) return -1;

            int deviceCount;
            if (devices.GetCount(out deviceCount) != 0) return -1;

            for (int d = 0; d < deviceCount; d++)
            {
                IMMDevice device;
                if (devices.Item(d, out device) != 0) continue;

                object mgrObj = null;
                try
                {
                    Guid iid = typeof(IAudioSessionManager2).GUID;
                    // CLSCTX_ALL = 23
                    if (device.Activate(ref iid, 23, IntPtr.Zero, out mgrObj) != 0) continue;
                    IAudioSessionManager2 mgr = (IAudioSessionManager2)mgrObj;

                    IAudioSessionEnumerator sessions;
                    if (mgr.GetSessionEnumerator(out sessions) != 0) continue;

                    int count;
                    if (sessions.GetCount(out count) != 0) continue;

                    for (int s = 0; s < count; s++)
                    {
                        IAudioSessionControl2 ctl;
                        if (sessions.GetSession(s, out ctl) != 0) continue;

                        int pid;
                        if (ctl.GetProcessId(out pid) != 0) continue;

                        string pname;
                        try { pname = Process.GetProcessById(pid).ProcessName; }
                        catch { continue; }
                        if (!IsWeProcess(pname)) continue;

                        // IAudioSessionControl2 不继承 ISimpleAudioVolume，需 QueryInterface
                        IntPtr pUnk = Marshal.GetIUnknownForObject(ctl);
                        if (pUnk == IntPtr.Zero) continue;
                        try
                        {
                            Guid volIid = typeof(ISimpleAudioVolume).GUID;
                            IntPtr pVol;
                            if (Marshal.QueryInterface(pUnk, ref volIid, out pVol) != 0) continue;
                            try
                            {
                                ISimpleAudioVolume vol = (ISimpleAudioVolume)Marshal.GetObjectForIUnknown(pVol);
                                Guid ctx = Guid.Empty;
                                if (vol.SetMute(mute, ref ctx) == 0) changed++;
                            }
                            finally { Marshal.Release(pVol); }
                        }
                        finally { Marshal.Release(pUnk); }
                    }
                }
                finally
                {
                    if (mgrObj != null && Marshal.IsComObject(mgrObj)) Marshal.ReleaseComObject(mgrObj);
                }
            }
        }
        catch { return -1; }
        finally
        {
            if (enumObj != null && Marshal.IsComObject(enumObj)) Marshal.ReleaseComObject(enumObj);
        }
        return changed;
    }

    static string Title(IntPtr h)
    {
        var s = new StringBuilder(512);
        GetWindowTextW(h, s, 512);
        return s.ToString();
    }

    static IntPtr FindByTitle(string title)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (found == IntPtr.Zero && Title(h) == title) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // --close <标题>：给窗口发 WM_CLOSE 并等它消失（不依赖 WE 的 -control 通道）
    static int CloseByTitle(string title)
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
        IntPtr h = FindByTitle(title);
        if (h == IntPtr.Zero) return 0;
        try { PostMessageW(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero); } catch { }
        for (int i = 0; i < 40; i++)
        {
            Thread.Sleep(50);
            if (!IsWindow(h)) return 0;
        }
        return 1;
    }

    // --find <标题>：窗口在就退出 0，不在退出 1
    static int FindOnly(string title)
    {
        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }
        return FindByTitle(title) == IntPtr.Zero ? 1 : 0;
    }

    // --mute-we 1|0：静音/恢复 Wallpaper Engine 的音频会话；stdout 输出会话数
    static int MuteWe(string flag)
    {
        bool mute = flag == "1" || flag.Equals("true", StringComparison.OrdinalIgnoreCase);
        int n = SetWeMute(mute);
        Console.Out.Write(n);
        Console.Out.Flush();
        return n < 0 ? 3 : 0;
    }

    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--close") return CloseByTitle(args[1]);
        if (args.Length >= 2 && args[0] == "--find") return FindOnly(args[1]);
        if (args.Length >= 2 && args[0] == "--mute-we") return MuteWe(args[1]);

        if (args.Length < 2) return 2;
        string title = args[0];
        ulong raw;
        if (!ulong.TryParse(args[1], out raw) || raw == 0) return 2;
        IntPtr host = new IntPtr(unchecked((long)raw));

        try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch { }

        IntPtr we = IntPtr.Zero;

        while (true)
        {
            if (!IsWindow(host)) return 0;

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

            RECT cr;
            if (!GetClientRect(host, out cr)) { Thread.Sleep(100); continue; }
            POINT tl = new POINT(); tl.X = cr.L; tl.Y = cr.T;
            POINT br = new POINT(); br.X = cr.R; br.Y = cr.B;
            if (!ClientToScreen(host, ref tl) || !ClientToScreen(host, ref br)) { Thread.Sleep(100); continue; }
            int x = tl.X, y = tl.Y, w = br.X - tl.X, h = br.Y - tl.Y;

            if (IsIconic(host) || w <= 0 || h <= 0)
            {
                ShowWindow(we, SW_HIDE);
            }
            else
            {
                ShowWindow(we, SW_SHOWNA);
                SetWindowPos(we, host, x, y, w, h, SWP_NOACTIVATE | SWP_NOSENDCHANGING);
            }
            Thread.Sleep(33);
        }
    }
}
