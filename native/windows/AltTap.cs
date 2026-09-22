// Bare left/right Alt taps for Windows. No key contents are retained or logged.
// Normal chords pass through. Only a completed bare tap gets a menu-mask release.
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal sealed class AltGesture
{
    internal const int LeftAlt = 0xA4, RightAlt = 0xA5;
    private int candidate;
    private long pressedAt;
    private bool eligible;
    private readonly bool[] held = new bool[256];

    internal static bool IsAlt(int key) { return key == LeftAlt || key == RightAlt; }
    internal bool HasCandidate { get { return candidate != 0; } }
    internal void Interrupt() { eligible = false; }
    internal void Reset()
    {
        candidate = 0;
        eligible = false;
        Array.Clear(held, 0, held.Length);
    }

    // otherHeld is sampled for other keys only: Windows has not yet updated the
    // asynchronous state of the key currently being delivered to a low-level hook.
    internal bool Key(int key, bool down, bool injected, bool otherHeld, long now)
    {
        if (key < 0 || key >= held.Length) { Interrupt(); return false; }
        if (injected) { Interrupt(); return false; }
        bool repeat = down && held[key];
        held[key] = down;
        if (!IsAlt(key)) { if (down) Interrupt(); return false; }
        if (down)
        {
            if (candidate != 0 || repeat) { Interrupt(); return false; }
            candidate = key;
            pressedAt = now;
            eligible = !otherHeld;
            for (int i = 0; i < held.Length; i++)
                if (i != key && held[i]) eligible = false;
            return false;
        }
        if (candidate != key) { Interrupt(); return false; }
        bool trigger = eligible && !otherHeld && now >= pressedAt && now - pressedAt < 800;
        candidate = 0;
        eligible = false;
        return trigger;
    }
}

internal static class AltTap
{
    private const int KeyboardHook = 13, MouseHook = 14;
    private const int KeyDown = 0x100, KeyUp = 0x101, SysKeyDown = 0x104, SysKeyUp = 0x105;
    private const uint Injected = 0x10, LowerIntegrityInjected = 0x02;
    private const uint InputKeyboard = 1, ExtendedKey = 1, KeyUpFlag = 2;
    private static readonly UIntPtr Marker = new UIntPtr(0x4D4D414C);
    private static readonly AltGesture Gesture = new AltGesture();
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly ConcurrentQueue<string> Output = new ConcurrentQueue<string>();
    private static readonly AutoResetEvent OutputReady = new AutoResetEvent(false);
    private static readonly HookProc KeyboardCallback = OnKeyboard;
    private static readonly HookProc MouseCallback = OnMouse;
    private static IntPtr keyboard, mouse, pressedWindow;
    private static volatile bool stopping;
    private static int queuedOutput;
    private static Process parent;
    private static long lastHeartbeat;

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardData
    {
        internal uint key, scan, flags, time;
        internal UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput
    {
        internal ushort key, scan;
        internal uint flags, time;
        internal UIntPtr extra;
    }
    // INPUT's union includes MOUSEINPUT, whose size is 32 bytes on x64.
    [StructLayout(LayoutKind.Explicit, Size = 32)]
    internal struct InputUnion { [FieldOffset(0)] internal KeyboardInput keyboard; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { internal uint type; internal InputUnion data; }

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int kind, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);

    private static void Emit(string line)
    {
        // Never block the hook thread on a paused/crashed Electron stdout reader.
        if (Interlocked.Increment(ref queuedOutput) > 32)
        {
            Interlocked.Decrement(ref queuedOutput);
            return;
        }
        Output.Enqueue(line);
        OutputReady.Set();
    }

    private static void WriteOutput()
    {
        try
        {
            while (!stopping || !Output.IsEmpty)
            {
                OutputReady.WaitOne(1000);
                string line;
                while (Output.TryDequeue(out line))
                {
                    Interlocked.Decrement(ref queuedOutput);
                    Console.Out.WriteLine(line);
                    Console.Out.Flush();
                }
            }
        }
        catch { Environment.Exit(0); } // Parent's pipe is closed; do not remain resident.
    }

    private static bool OtherKeyHeld(int alt)
    {
        for (int key = 1; key < 256; key++)
        {
            if (key == alt || key == 0x12) continue; // generic VK_MENU aliases the current Alt
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        }
        return false;
    }

    internal static Input[] MenuMaskInputs(int alt)
    {
        // Ctrl prevents the bare Alt release from entering the foreground menu.
        // Pair every injected key; never swallow Alt-up while leaving Alt held.
        return new Input[] {
            MakeInput(0xA2, 0),
            MakeInput((ushort)alt, KeyUpFlag | (alt == AltGesture.RightAlt ? ExtendedKey : 0)),
            MakeInput(0xA2, KeyUpFlag)
        };
    }

    private static Input MakeInput(ushort key, uint flags)
    {
        Input input = new Input();
        input.type = InputKeyboard;
        input.data.keyboard.key = key;
        input.data.keyboard.flags = flags;
        input.data.keyboard.extra = Marker;
        return input;
    }

    private static bool MaskMenuRelease(int alt)
    {
        Input[] inputs = MenuMaskInputs(alt);
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent == inputs.Length) return true;
        // A zero return (including UIPI denial) must leave the physical Alt-up
        // untouched. If only part was accepted, also release our temporary Ctrl.
        if (sent != 0)
        {
            Input[] cleanup = new Input[] { MakeInput(0xA2, KeyUpFlag) };
            SendInput(1, cleanup, Marshal.SizeOf(typeof(Input)));
        }
        return false;
    }

    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int kind = message.ToInt32();
            bool down = kind == KeyDown || kind == SysKeyDown;
            if (down || kind == KeyUp || kind == SysKeyUp)
            {
                KeyboardData info = (KeyboardData)Marshal.PtrToStructure(data, typeof(KeyboardData));
                if (info.extra == Marker && (info.flags & Injected) != 0)
                    return CallNextHookEx(keyboard, code, message, data);
                int key = (int)info.key;
                if (key == 0x12) key = (info.flags & 1) != 0 ? AltGesture.RightAlt : AltGesture.LeftAlt;
                bool injected = (info.flags & (Injected | LowerIntegrityInjected)) != 0;
                bool alt = AltGesture.IsAlt(key);
                if (alt && down && !Gesture.HasCandidate) pressedWindow = GetForegroundWindow();
                if (Gesture.HasCandidate && pressedWindow != GetForegroundWindow()) Gesture.Interrupt();
                bool otherHeld = alt && OtherKeyHeld(key);
                if (Gesture.Key(key, down, injected, otherHeld, Clock.ElapsedMilliseconds) && MaskMenuRelease(key))
                {
                    Emit("{\"type\":\"trigger\"}");
                    return new IntPtr(1);
                }
            }
        }
        return CallNextHookEx(keyboard, code, message, data);
    }

    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0)
        {
            int kind = message.ToInt32();
            if (kind == 0x201 || kind == 0x204 || kind == 0x207 || kind == 0x20B ||
                kind == 0x20A || kind == 0x20E) Gesture.Interrupt();
        }
        return CallNextHookEx(mouse, code, message, data);
    }

    private static bool InstallHooks()
    {
        IntPtr module = GetModuleHandle(null);
        IntPtr nextKeyboard = SetWindowsHookEx(KeyboardHook, KeyboardCallback, module, 0);
        IntPtr nextMouse = SetWindowsHookEx(MouseHook, MouseCallback, module, 0);
        if (nextKeyboard == IntPtr.Zero || nextMouse == IntPtr.Zero)
        {
            if (nextKeyboard != IntPtr.Zero) UnhookWindowsHookEx(nextKeyboard);
            if (nextMouse != IntPtr.Zero) UnhookWindowsHookEx(nextMouse);
            return false;
        }
        IntPtr previousKeyboard = keyboard, previousMouse = mouse;
        keyboard = nextKeyboard; mouse = nextMouse;
        if (previousKeyboard != IntPtr.Zero) UnhookWindowsHookEx(previousKeyboard);
        if (previousMouse != IntPtr.Zero) UnhookWindowsHookEx(previousMouse);
        Gesture.Reset();
        return true;
    }

    private static bool ParentAlive()
    {
        try { return parent != null && !parent.HasExited; }
        catch { return false; }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        int parentId;
        if (args.Length != 2 || args[0] != "--parent-pid" || !Int32.TryParse(args[1], out parentId) || parentId <= 0)
            return 2;
        try { parent = Process.GetProcessById(parentId); }
        catch { return 2; }
        Thread writer = new Thread(WriteOutput); writer.IsBackground = true; writer.Start();
        bool ready = ParentAlive() && InstallHooks();
        Emit(ready ? "{\"type\":\"status\",\"ready\":true}" : "{\"type\":\"status\",\"ready\":false}");
        if (!ready) { stopping = true; OutputReady.Set(); writer.Join(1000); return 2; }
        using (System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer())
        {
            timer.Interval = 1000;
            timer.Tick += delegate
            {
                if (!ParentAlive()) { Application.ExitThread(); return; }
                long now = Clock.ElapsedMilliseconds;
                if (now - lastHeartbeat < 5000) return;
                lastHeartbeat = now;
                // Windows can silently remove timed-out LL hooks. Reinstall only
                // between gestures; keep all hook callbacks free of pipe/file IO.
                bool altHeld = (GetAsyncKeyState(AltGesture.LeftAlt) & 0x8000) != 0 ||
                    (GetAsyncKeyState(AltGesture.RightAlt) & 0x8000) != 0;
                bool healthy = altHeld ? keyboard != IntPtr.Zero && mouse != IntPtr.Zero : InstallHooks();
                Emit(healthy ? "{\"type\":\"status\",\"ready\":true}" : "{\"type\":\"status\",\"ready\":false}");
                if (!healthy) Application.ExitThread();
            };
            timer.Start();
            Application.Run();
        }
        UnhookWindowsHookEx(keyboard); UnhookWindowsHookEx(mouse);
        parent.Dispose();
        stopping = true; OutputReady.Set(); writer.Join(1000);
        return 0;
    }

    private static void Check(bool value, string name)
    {
        if (!value) throw new Exception("FAILED: " + name);
    }

    private static int SelfTest()
    {
        try
        {
            foreach (int alt in new int[] { AltGesture.LeftAlt, AltGesture.RightAlt })
            {
                AltGesture g = new AltGesture();
                Check(!g.Key(alt, true, false, false, 10), "press does not trigger");
                Check(g.Key(alt, false, false, false, 120), "either bare Alt triggers on release");
                Check(!g.Key(alt, false, false, false, 130), "duplicate release");
                g.Key(alt, true, false, false, 200);
                g.Key(alt, true, false, false, 220);
                Check(!g.Key(alt, false, false, false, 300), "key repeat");
                foreach (int other in new int[] { 0x09, 0x73, 0xA2, 0xA0, 0x5B, 0x41, alt == 0xA4 ? 0xA5 : 0xA4 })
                {
                    g.Reset(); g.Key(alt, true, false, false, 0);
                    g.Key(other, true, false, true, 20); g.Key(other, false, false, true, 30);
                    Check(!g.Key(alt, false, false, false, 40), "Alt chord");
                    g.Reset(); g.Key(other, true, false, false, 0);
                    g.Key(alt, true, false, true, 20); g.Key(other, false, false, true, 30);
                    Check(!g.Key(alt, false, false, false, 40), "pre-held key including AltGr Ctrl");
                }
                g.Reset(); g.Key(alt, true, false, false, 0);
                Check(!g.Key(alt, false, false, false, 800), "long hold");
                g.Reset(); g.Key(alt, true, false, false, 0); g.Interrupt();
                Check(!g.Key(alt, false, false, false, 100), "mouse/focus interruption");
                g.Reset(); g.Key(alt, true, true, false, 0);
                Check(!g.Key(alt, false, true, false, 100), "synthetic Alt never triggers");
                g.Reset(); g.Key(alt, true, false, false, 0); g.Key(0x41, true, true, false, 20);
                Check(!g.Key(alt, false, false, false, 100), "injected intervening key");
                g.Reset(); g.Key(alt, true, false, false, 100);
                Check(!g.Key(alt, false, false, false, 50), "clock rollback");
                g.Reset(); g.Key(alt, true, false, false, 0); g.Reset();
                Check(!g.Key(alt, false, false, false, 100), "wake/reset release");
                g.Reset(); g.Key(alt, true, false, false, 0);
                Check(!g.Key(alt, false, false, true, 100), "held key on release");
                Input[] inputs = MenuMaskInputs(alt);
                Check(inputs.Length == 3 && inputs[0].data.keyboard.key == 0xA2 &&
                    inputs[0].data.keyboard.flags == 0 && inputs[1].data.keyboard.key == alt &&
                    (inputs[1].data.keyboard.flags & KeyUpFlag) != 0 &&
                    ((inputs[1].data.keyboard.flags & ExtendedKey) != 0) == (alt == AltGesture.RightAlt) &&
                    inputs[2].data.keyboard.key == 0xA2 && inputs[2].data.keyboard.flags == KeyUpFlag,
                    "paired menu mask and side-correct Alt release");
            }
            Check(IntPtr.Size == 8 && Marshal.SizeOf(typeof(Input)) == 40, "Windows x64 INPUT ABI");
            Console.WriteLine("PASS: both Alt taps, chords/AltGr, repeats, holds, mouse/focus, injected input, reset and menu-mask pairing.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
