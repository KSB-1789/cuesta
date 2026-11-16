# Cuesta Win32 & UI Automation Action Worker
# Resident PowerShell background process communicating over stdin for <15ms key/mouse/window/UIA dispatch.

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$source = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;

public class Win32Input {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, int dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public static string GetForegroundInfo() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "{\"title\":\"\",\"processName\":\"\"}";
            System.Text.StringBuilder sb = new System.Text.StringBuilder(256);
            GetWindowText(hwnd, sb, 256);
            string title = sb.ToString();
            uint pid = 0;
            GetWindowThreadProcessId(hwnd, out pid);
            string procName = "";
            if (pid > 0) {
                try {
                    System.Diagnostics.Process proc = System.Diagnostics.Process.GetProcessById((int)pid);
                    procName = proc.ProcessName;
                } catch {}
            }
            string safeTitle = title.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
            string safeProc = procName.Replace("\\", "\\\\").Replace("\"", "\\\"");
            return "{\"title\":\"" + safeTitle + "\",\"processName\":\"" + safeProc + "\"}";
        } catch {
            return "{\"title\":\"\",\"processName\":\"\"}";
        }
    }

    public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    public const uint MOUSEEVENTF_HWHEEL     = 0x01000;
    public const uint KEYEVENTF_KEYUP        = 0x0002;

    public const byte VK_LWIN        = 0x5B;
    public const byte VK_H           = 0x48;
    public const byte VK_D           = 0x44;
    public const byte VK_LEFT        = 0x25;
    public const byte VK_UP          = 0x26;
    public const byte VK_RIGHT       = 0x27;
    public const byte VK_DOWN        = 0x28;
    public const byte VK_VOLUME_MUTE = 0xAD;
    public const byte VK_VOLUME_DOWN = 0xAE;
    public const byte VK_VOLUME_UP   = 0xAF;

    public static void LeftClick() {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP,   0, 0, 0, 0);
    }

    public static void DoubleClick() {
        LeftClick();
        System.Threading.Thread.Sleep(45);
        LeftClick();
    }

    public static void RightClick() {
        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_RIGHTUP,   0, 0, 0, 0);
    }

    public static void ScrollHorizontal(int delta) {
        mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, delta, 0);
    }

    public static void MoveTo(int x, int y) {
        SetCursorPos(x, y);
    }

    public static void PressTap(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    public static void WinCombo(byte vk) {
        keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static Condition BuildClickableCondition() {
        return new OrCondition(
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Hyperlink),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.CheckBox),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.RadioButton),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit)
        );
    }

    public static string ListForegroundElements() {
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "[]";
            AutomationElement root = AutomationElement.FromHandle(hwnd);
            if (root == null) return "[]";
            AutomationElementCollection found = root.FindAll(TreeScope.Descendants, BuildClickableCondition());
            List<string> items = new List<string>();
            int limit = Math.Min(found.Count, 30);
            for (int i = 0; i < found.Count && items.Count < 24; i++) {
                AutomationElement el = found[i];
                if (el.Current.IsOffscreen) continue;
                string name = (el.Current.Name ?? "").Trim();
                if (string.IsNullOrEmpty(name) || name.Length > 60) continue;
                Rect r = el.Current.BoundingRectangle;
                if (r.IsEmpty || r.Width <= 2 || r.Height <= 2) continue;
                int cx = (int)Math.Round(r.X + r.Width / 2.0);
                int cy = (int)Math.Round(r.Y + r.Height / 2.0);
                string cType = el.Current.ControlType != null ? el.Current.ControlType.ProgrammaticName.Replace("ControlType.", "") : "Control";
                string safeName = name.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ");
                items.Add("{\"name\":\"" + safeName + "\",\"controlType\":\"" + cType + "\",\"x\":" + cx + ",\"y\":" + cy + "}");
            }
            return "[" + string.Join(",", items.ToArray()) + "]";
        } catch {
            return "[]";
        }
    }

    public static string ClickElementByName(string query) {
        if (string.IsNullOrWhiteSpace(query)) return "{\"ok\":false,\"reason\":\"Empty target name.\"}";
        string needle = query.Trim().ToLowerInvariant();
        try {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return "{\"ok\":false,\"reason\":\"No active window.\"}";
            AutomationElement root = AutomationElement.FromHandle(hwnd);
            if (root == null) return "{\"ok\":false,\"reason\":\"Active window unreadable.\"}";
            AutomationElementCollection found = root.FindAll(TreeScope.Descendants, BuildClickableCondition());

            AutomationElement exact = null;
            AutomationElement partial = null;
            for (int i = 0; i < found.Count; i++) {
                AutomationElement el = found[i];
                if (el.Current.IsOffscreen) continue;
                string name = (el.Current.Name ?? "").Trim();
                if (string.IsNullOrEmpty(name)) continue;
                Rect r = el.Current.BoundingRectangle;
                if (r.IsEmpty || r.Width <= 2 || r.Height <= 2) continue;
                string lower = name.ToLowerInvariant();
                if (lower == needle) { exact = el; break; }
                if (partial == null && lower.Contains(needle)) { partial = el; }
            }

            AutomationElement target = exact ?? partial;
            if (target == null) {
                string safeQ = query.Replace("\\", "\\\\").Replace("\"", "\\\"");
                return "{\"ok\":false,\"reason\":\"Could not find control matching '" + safeQ + "'.\"}";
            }

            Rect rect = target.Current.BoundingRectangle;
            int tx = (int)Math.Round(rect.X + rect.Width / 2.0);
            int ty = (int)Math.Round(rect.Y + rect.Height / 2.0);
            MoveTo(tx, ty);
            System.Threading.Thread.Sleep(20);
            LeftClick();
            string matched = (target.Current.Name ?? query).Replace("\\", "\\\\").Replace("\"", "\\\"");
            return "{\"ok\":true,\"matchedName\":\"" + matched + "\"}";
        } catch (Exception ex) {
            string msg = ex.Message.Replace("\\", "\\\\").Replace("\"", "\\\"");
            return "{\"ok\":false,\"reason\":\"" + msg + "\"}";
        }
    }
}
"@

try {
    $uiaClient = [System.Windows.Automation.AutomationElement].Assembly.Location
    $uiaTypes  = [System.Windows.Automation.ControlType].Assembly.Location
    $winBase   = [System.Windows.Rect].Assembly.Location
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @($uiaClient, $uiaTypes, $winBase)
    [Win32Input]::SetProcessDPIAware() | Out-Null
} catch {
    [Console]::Error.WriteLine("Win32Input init error: $($_.Exception.Message)")
}

function Emit-B64($prefix, $text) {
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
    [Console]::Out.WriteLine("${prefix}${b64}")
}

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq "") { continue }
    if ($line -eq "QUIT") { break }

    try {
        switch -Regex ($line) {
            "^SELECT$"            { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); [Console]::Out.WriteLine("OK SELECT") }
            "^NEXT$"              { [System.Windows.Forms.SendKeys]::SendWait("{TAB}"); [Console]::Out.WriteLine("OK NEXT") }
            "^PREV$"              { [System.Windows.Forms.SendKeys]::SendWait("+{TAB}"); [Console]::Out.WriteLine("OK PREV") }
            "^BACK$"              { [System.Windows.Forms.SendKeys]::SendWait("%{LEFT}"); [Console]::Out.WriteLine("OK BACK") }
            "^SCROLL_DOWN$"       { [System.Windows.Forms.SendKeys]::SendWait("{PGDN}"); [Console]::Out.WriteLine("OK SCROLL_DOWN") }
            "^SCROLL_UP$"         { [System.Windows.Forms.SendKeys]::SendWait("{PGUP}"); [Console]::Out.WriteLine("OK SCROLL_UP") }
            "^SCROLL_LEFT$"       { [Win32Input]::ScrollHorizontal(-240); [Console]::Out.WriteLine("OK SCROLL_LEFT") }
            "^SCROLL_RIGHT$"      { [Win32Input]::ScrollHorizontal(240); [Console]::Out.WriteLine("OK SCROLL_RIGHT") }
            "^(CLICK|LEFT_CLICK)$" { [Win32Input]::LeftClick(); [Console]::Out.WriteLine("OK CLICK") }
            "^DOUBLE_CLICK$"      { [Win32Input]::DoubleClick(); [Console]::Out.WriteLine("OK DOUBLE_CLICK") }
            "^RIGHT_CLICK$"       { [Win32Input]::RightClick(); [Console]::Out.WriteLine("OK RIGHT_CLICK") }
            "^PASTE$"             { [System.Windows.Forms.SendKeys]::SendWait("^v"); [Console]::Out.WriteLine("OK PASTE") }
            "^UNDO$"              { [System.Windows.Forms.SendKeys]::SendWait("^z"); [Console]::Out.WriteLine("OK UNDO") }
            "^COPY$"              { [System.Windows.Forms.SendKeys]::SendWait("^c"); [Console]::Out.WriteLine("OK COPY") }
            "^ESCAPE$"            { [System.Windows.Forms.SendKeys]::SendWait("{ESC}"); [Console]::Out.WriteLine("OK ESCAPE") }
            "^ZOOM_IN$"           { [System.Windows.Forms.SendKeys]::SendWait("^{+}"); [Console]::Out.WriteLine("OK ZOOM_IN") }
            "^ZOOM_OUT$"          { [System.Windows.Forms.SendKeys]::SendWait("^-"); [Console]::Out.WriteLine("OK ZOOM_OUT") }
            "^SWITCH_WINDOW$"     { [System.Windows.Forms.SendKeys]::SendWait("%{TAB}"); [Console]::Out.WriteLine("OK SWITCH_WINDOW") }
            "^CLOSE_WINDOW$"      { [System.Windows.Forms.SendKeys]::SendWait("%{F4}"); [Console]::Out.WriteLine("OK CLOSE_WINDOW") }
            "^SNAP_LEFT$"         { [Win32Input]::WinCombo([Win32Input]::VK_LEFT); [Console]::Out.WriteLine("OK SNAP_LEFT") }
            "^SNAP_RIGHT$"        { [Win32Input]::WinCombo([Win32Input]::VK_RIGHT); [Console]::Out.WriteLine("OK SNAP_RIGHT") }
            "^MAXIMIZE_WINDOW$"   { [Win32Input]::WinCombo([Win32Input]::VK_UP); [Console]::Out.WriteLine("OK MAXIMIZE_WINDOW") }
            "^MINIMIZE_WINDOW$"   { [Win32Input]::WinCombo([Win32Input]::VK_DOWN); [Console]::Out.WriteLine("OK MINIMIZE_WINDOW") }
            "^SHOW_DESKTOP$"      { [Win32Input]::WinCombo([Win32Input]::VK_D); [Console]::Out.WriteLine("OK SHOW_DESKTOP") }
            "^VOL_UP$"            { [Win32Input]::PressTap([Win32Input]::VK_VOLUME_UP); [Console]::Out.WriteLine("OK VOL_UP") }
            "^VOL_DOWN$"          { [Win32Input]::PressTap([Win32Input]::VK_VOLUME_DOWN); [Console]::Out.WriteLine("OK VOL_DOWN") }
            "^VOL_MUTE$"          { [Win32Input]::PressTap([Win32Input]::VK_VOLUME_MUTE); [Console]::Out.WriteLine("OK VOL_MUTE") }
            "^VOICE_TYPING$"      { [Win32Input]::WinCombo([Win32Input]::VK_H); [Console]::Out.WriteLine("OK VOICE_TYPING") }
            "^FOREGROUND_INFO$" {
                $info = [Win32Input]::GetForegroundInfo()
                Emit-B64 "FOREGROUND_INFO_B64:" $info
            }
            "^UI_LIST$" {
                $json = [Win32Input]::ListForegroundElements()
                Emit-B64 "UI_LIST_B64:" $json
            }
            "^UI_CLICK_B64:(.+)$" {
                $target = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Matches[1]))
                $res = [Win32Input]::ClickElementByName($target)
                Emit-B64 "UI_CLICK_B64:" $res
            }
            "^KEY:(.+)$" {
                $k = $Matches[1]
                [System.Windows.Forms.SendKeys]::SendWait($k)
                [Console]::Out.WriteLine("OK KEY $k")
            }
            "^MOVE_NORM:([0-9.]+),([0-9.]+)$" {
                $nx = [double]$Matches[1]
                $ny = [double]$Matches[2]
                $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
                $cx = $bounds.X + [int][Math]::Round($nx * [Math]::Max(1, $bounds.Width - 1))
                $cy = $bounds.Y + [int][Math]::Round($ny * [Math]::Max(1, $bounds.Height - 1))
                [Win32Input]::MoveTo($cx, $cy)
            }
            "^MOVE_CURSOR:(-?\d+),(-?\d+)$" {
                $cx = [int]$Matches[1]
                $cy = [int]$Matches[2]
                [Win32Input]::MoveTo($cx, $cy)
            }
            "^CURSOR_CLICK$" {
                [Win32Input]::LeftClick()
                [Console]::Out.WriteLine("OK CURSOR_CLICK")
            }
            default {
                [Console]::Out.WriteLine("ERR Unknown command: $line")
            }
        }
    } catch {
        [Console]::Out.WriteLine("ERR $($_.Exception.Message)")
    }
    [Console]::Out.Flush()
}
