$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class CuestaKeyboardHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_LSHIFT = 0xA0;
    private const int VK_RSHIFT = 0xA1;
    private const int VK_LCONTROL = 0xA2;
    private const int VK_RCONTROL = 0xA3;

    private static bool shiftDown;
    private static bool ctrlDown;
    private static bool winDown;
    private static bool armedCtrlWin;
    private static bool armedShiftWin;
    private static bool suppressWinUp;

    private static LowLevelKeyboardProc callback = HookCallback;
    private static IntPtr hook = IntPtr.Zero;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vk = Marshal.ReadInt32(lParam);
            int message = wParam.ToInt32();
            bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            bool up = message == WM_KEYUP || message == WM_SYSKEYUP;
            bool isWinKey = vk == VK_LWIN || vk == VK_RWIN;
            if (down) {
                if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT) shiftDown = true;
                if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL) ctrlDown = true;
                if (isWinKey) winDown = true;

                if (ctrlDown && winDown && !armedCtrlWin) {
                    armedCtrlWin = true;
                    suppressWinUp = true;
                    Console.WriteLine("CUESTA_CTRL_WIN");
                    Console.Out.Flush();
                }
                if (shiftDown && winDown && !armedShiftWin) {
                    armedShiftWin = true;
                    suppressWinUp = true;
                    Console.WriteLine("CUESTA_SHIFT_WIN");
                    Console.Out.Flush();
                }
            } else if (up) {
                if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT) shiftDown = false;
                if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL) ctrlDown = false;
                if (isWinKey) {
                    winDown = false;
                    if (suppressWinUp) {
                        suppressWinUp = false;
                        armedCtrlWin = false;
                        armedShiftWin = false;
                        return (IntPtr)1;
                    }
                }

                if (!ctrlDown || !winDown) armedCtrlWin = false;
                if (!shiftDown || !winDown) armedShiftWin = false;
            }
            bool isModifier = vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT ||
                              vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL ||
                              isWinKey;
            if (isModifier && ((ctrlDown && winDown) || (shiftDown && winDown))) return (IntPtr)1;
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    public static void Run() {
        using (Process current = Process.GetCurrentProcess())
        using (ProcessModule module = current.MainModule) {
            hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(module.ModuleName), 0);
        }
        if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
        Application.Run();
        UnhookWindowsHookEx(hook);
    }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms'
[CuestaKeyboardHook]::Run()
