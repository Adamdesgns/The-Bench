// TickerStrip.cs - a thin scrolling ticker docked right above the Windows taskbar, always visible.
// Compiled at launch by ticker-strip.ps1 (Add-Type), so nothing needs installing.
//
// It registers as an app bar (the same Windows mechanism the taskbar uses), so maximized windows stop
// above it instead of covering it. It steps aside while a full-screen app (a game, a video) is up.
//
// Data: db/ticker-feed.json, written by scripts/ticker-feed.mjs. The strip runs that script itself
// (hidden, every 60 s in market hours, every 10 min otherwise) and redraws when it finishes.
// Hover = pause. Click a ticker = open it on robinhood.com. Right-click = refresh / pause / quit.
// Read only: it never places an order and never touches an account.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public class TickerStrip : Form
{
    // ---- app bar plumbing (shell32 SHAppBarMessage) ----
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    struct APPBARDATA { public uint cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam; }
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    [DllImport("user32.dll")] static extern uint RegisterWindowMessage(string s);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABE_BOTTOM = 3;
    const int ABN_POSCHANGED = 1, ABN_FULLSCREENAPP = 2;
    uint callbackMsg;
    bool registered;

    // ---- data ----
    class Item { public string Sym, Tag; public double? Price, Pct, ExtPrice, ExtPct; public string ExtSession; public bool Stale, Crypto; }
    readonly string root, feedPath, nodeExe, alsoPath, extraScript;
    List<Item> items = new List<Item>();
    DateTime updated = DateTime.MinValue;
    int refreshing; // 1 while the feed script runs

    // ---- drawing ----
    readonly Font symFont, numFont, smallFont;
    readonly int barH, boxW;
    Bitmap strip;                          // the whole ticker line, drawn once per data change
    readonly List<KeyValuePair<float, Item>> hits = new List<KeyValuePair<float, Item>>(); // item start x -> item
    // GenericTypographic hands back a NEW GDI+ object on every read, so one copy is kept for the life of the strip.
    static readonly StringFormat Typo = StringFormat.GenericTypographic;
    float offset;                          // scroll position inside the strip
    bool hover, paused;
    readonly Stopwatch clock = Stopwatch.StartNew();
    long lastTick;
    const float SpeedPerSec = 45f;         // pixels per second at 96 dpi, scaled
    readonly float scale;

    static readonly Color Bg = Color.FromArgb(14, 17, 23), Line = Color.FromArgb(38, 44, 56);
    static readonly Color Up = Color.FromArgb(46, 204, 113), Down = Color.FromArgb(255, 84, 84);
    static readonly Color Txt = Color.FromArgb(236, 239, 244), Dim = Color.FromArgb(132, 140, 156), Amber = Color.FromArgb(255, 183, 77);

    static Color TagColor(string tag)
    {
        switch (tag)
        {
            case "pump": return Color.FromArgb(255, 138, 61);
            case "stack": return Color.FromArgb(77, 166, 255);
            case "hot": return Color.FromArgb(255, 214, 10);
            case "pin": return Color.FromArgb(186, 129, 255);
            default: return Color.FromArgb(110, 118, 134); // gauge
        }
    }

    public TickerStrip(string rootDir, string node, string also, string extra)
    {
        root = rootDir; nodeExe = node; alsoPath = also; extraScript = extra;
        feedPath = Path.Combine(root, "db", "ticker-feed.json");
        using (var g = CreateGraphics()) scale = g.DpiX / 96f;
        barH = (int)Math.Round(28 * scale);
        boxW = (int)Math.Round(108 * scale);
        symFont = new Font("Segoe UI Semibold", 9.5f);
        numFont = new Font("Segoe UI", 9.5f);
        smallFont = new Font("Segoe UI", 8f);

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        Text = "Bench Ticker";
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);

        var menu = new ContextMenuStrip();
        menu.Items.Add("Refresh now", null, delegate { RefreshFeed(true); });
        var pauseItem = new ToolStripMenuItem("Pause scrolling");
        pauseItem.Click += delegate { paused = !paused; pauseItem.Checked = paused; };
        menu.Items.Add(pauseItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit ticker", null, delegate { Close(); });
        ContextMenuStrip = menu;

        MouseEnter += delegate { hover = true; };
        MouseLeave += delegate { hover = false; };
        MouseClick += OnClick;

        var frame = new System.Windows.Forms.Timer { Interval = 15 };
        frame.Tick += delegate { Step(); };
        frame.Start();

        var poll = new System.Windows.Forms.Timer { Interval = 15000 };
        poll.Tick += delegate { RefreshFeed(false); Invalidate(new Rectangle(0, 0, boxW, barH)); };
        poll.Start();

        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += delegate { if (registered) DockBar(); };
        LoadFeed();
    }

    // Keep the window out of Alt+Tab.
    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x80 /* WS_EX_TOOLWINDOW */; return cp; }
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        var abd = NewData();
        callbackMsg = RegisterWindowMessage("BenchTickerStripAppBar");
        abd.uCallbackMessage = callbackMsg;
        SHAppBarMessage(ABM_NEW, ref abd);
        registered = true;
        DockBar();
        RefreshFeed(true);
    }

    APPBARDATA NewData()
    {
        var abd = new APPBARDATA();
        abd.cbSize = (uint)Marshal.SizeOf(typeof(APPBARDATA));
        abd.hWnd = Handle;
        return abd;
    }

    // Ask Windows for a strip along the bottom of the primary screen; it hands back the spot above the taskbar.
    void DockBar()
    {
        var b = Screen.PrimaryScreen.Bounds;
        var abd = NewData();
        abd.uEdge = ABE_BOTTOM;
        abd.rc.left = b.Left; abd.rc.right = b.Right; abd.rc.bottom = b.Bottom; abd.rc.top = b.Bottom - barH;
        SHAppBarMessage(ABM_QUERYPOS, ref abd);
        abd.rc.top = abd.rc.bottom - barH;
        SHAppBarMessage(ABM_SETPOS, ref abd);
        Bounds = new Rectangle(abd.rc.left, abd.rc.top, abd.rc.right - abd.rc.left, barH);
    }

    protected override void WndProc(ref Message m)
    {
        if (registered && m.Msg == (int)callbackMsg)
        {
            int code = m.WParam.ToInt32();
            if (code == ABN_POSCHANGED) DockBar();
            else if (code == ABN_FULLSCREENAPP) TopMost = m.LParam == IntPtr.Zero; // step aside for full-screen apps
        }
        base.WndProc(ref m);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (registered) { var abd = NewData(); SHAppBarMessage(ABM_REMOVE, ref abd); registered = false; }
        base.OnFormClosing(e);
    }

    // ---- refresh: run the feed script hidden, then reload ----
    static bool MarketHours()
    {
        var ny = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTime.UtcNow, "Eastern Standard Time");
        if (ny.DayOfWeek == DayOfWeek.Saturday || ny.DayOfWeek == DayOfWeek.Sunday) return false;
        return ny.Hour >= 4 && ny.Hour < 20; // pre-market through after hours
    }

    TimeSpan Interval { get { return MarketHours() ? TimeSpan.FromSeconds(60) : TimeSpan.FromMinutes(10); } }
    DateTime lastRun = DateTime.MinValue;

    // Run one node script hidden, at most 45 s; a hung script is killed so the next refresh can run.
    void RunNode(string args, string cwd)
    {
        var psi = new ProcessStartInfo(nodeExe, args)
        {
            WorkingDirectory = cwd, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        using (var p = Process.Start(psi))
        {
            p.OutputDataReceived += delegate { };
            p.ErrorDataReceived += delegate { };
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            if (!p.WaitForExit(45000)) { try { p.Kill(); } catch { } }
        }
    }

    void RefreshFeed(bool force)
    {
        if (!force && DateTime.UtcNow - lastRun < Interval) return;
        if (Interlocked.Exchange(ref refreshing, 1) == 1) return;
        lastRun = DateTime.UtcNow;
        ThreadPool.QueueUserWorkItem(delegate
        {
            try
            {
                var args = "\"" + Path.Combine(root, "scripts", "ticker-feed.mjs") + "\"";
                if (!string.IsNullOrEmpty(alsoPath)) args += " --also \"" + alsoPath + "\"";
                RunNode(args, root);
                // the wallpaper's six-desk floor (Bot Status\pod-desks.mjs); it skips itself when its file is under 4 min old
                if (!string.IsNullOrEmpty(extraScript) && File.Exists(extraScript))
                    RunNode("\"" + extraScript + "\"", Path.GetDirectoryName(extraScript));
            }
            catch { /* node missing or the script failed: keep the last good feed on screen */ }
            finally
            {
                Interlocked.Exchange(ref refreshing, 0);
                try { BeginInvoke((MethodInvoker)LoadFeed); } catch { }
            }
        });
    }

    static double? Num(object o) { if (o == null) return null; try { return Convert.ToDouble(o); } catch { return null; } }

    void LoadFeed()
    {
        try
        {
            var raw = File.ReadAllText(feedPath);
            var js = new JavaScriptSerializer();
            var feed = (Dictionary<string, object>)js.DeserializeObject(raw);
            var list = new List<Item>();
            foreach (var o in (IEnumerable)feed["items"])
            {
                var d = (Dictionary<string, object>)o;
                var it = new Item
                {
                    Sym = (string)d["sym"], Tag = d.ContainsKey("tag") ? (string)d["tag"] : "gauge",
                    Price = d.ContainsKey("price") ? Num(d["price"]) : null, Pct = d.ContainsKey("pct") ? Num(d["pct"]) : null,
                    Stale = d.ContainsKey("stale") && d["stale"] is bool && (bool)d["stale"],
                    Crypto = d.ContainsKey("crypto") && d["crypto"] is bool && (bool)d["crypto"],
                };
                var ext = d.ContainsKey("ext") ? d["ext"] as Dictionary<string, object> : null;
                if (ext != null) { it.ExtPrice = Num(ext["price"]); it.ExtPct = Num(ext["pct"]); it.ExtSession = ext["session"] as string; }
                list.Add(it);
            }
            items = list;
            updated = DateTime.Parse((string)feed["updated"]).ToLocalTime();
            BuildStrip();
        }
        catch { /* no feed yet or a bad read: keep what is on screen */ }
        Invalidate();
    }

    static string Fmt(double p) { return p >= 10000 ? p.ToString("N0") : p.ToString("N2"); }
    static string Pct(double p) { return (p >= 0 ? "+" : "") + p.ToString("0.00") + "%"; }

    // Draw the whole ticker line into one bitmap; each frame then just slides it.
    void BuildStrip()
    {
        hits.Clear();
        var gap = 26 * scale; var dot = 6 * scale; var pad = 6 * scale;
        var fmt = Typo;
        // first pass: measure
        float w = gap;
        using (var tmp = new Bitmap(1, 1))
        using (var g = Graphics.FromImage(tmp))
        {
            foreach (var it in items) w += ItemWidth(g, it, fmt, dot, pad) + gap;
        }
        if (strip != null) strip.Dispose();
        strip = new Bitmap(Math.Max(1, (int)Math.Ceiling(w)), barH);
        using (var g = Graphics.FromImage(strip))
        {
            g.Clear(Bg);
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float x = gap;
            foreach (var it in items)
            {
                hits.Add(new KeyValuePair<float, Item>(x, it));
                x = DrawItem(g, it, x, fmt, dot, pad) + gap;
            }
        }
        if (offset > strip.Width) offset = 0;
    }

    float TextY(Graphics g, Font f, StringFormat fmt) { return (barH - g.MeasureString("0", f, 1000, fmt).Height) / 2f; }

    float ItemWidth(Graphics g, Item it, StringFormat fmt, float dot, float pad)
    {
        return DrawItem(g, it, 0, fmt, dot, pad, true);
    }

    // Returns the x after the item. measureOnly skips the drawing.
    float DrawItem(Graphics g, Item it, float x, StringFormat fmt, float dot, float pad, bool measureOnly = false)
    {
        float start = x;
        if (!measureOnly)
            using (var b = new SolidBrush(TagColor(it.Tag)))
                g.FillEllipse(b, x, (barH - dot) / 2f, dot, dot);
        x += dot + pad;
        x = DrawText(g, it.Sym, symFont, it.Stale ? Dim : Txt, x, fmt, measureOnly) + pad;
        if (it.Price.HasValue) x = DrawText(g, Fmt(it.Price.Value), numFont, Dim, x, fmt, measureOnly) + pad;
        if (it.Pct.HasValue) x = DrawText(g, Pct(it.Pct.Value), numFont, it.Stale ? Dim : it.Pct.Value >= 0 ? Up : Down, x, fmt, measureOnly);
        if (!it.Price.HasValue) x = DrawText(g, "n/a", numFont, Dim, x, fmt, measureOnly);
        if (it.ExtPct.HasValue && it.ExtPrice.HasValue)
        {
            x += pad;
            var c = it.Stale ? Color.FromArgb(150, Dim) : it.ExtPct.Value >= 0 ? Color.FromArgb(150, Up) : Color.FromArgb(150, Down);
            x = DrawText(g, (it.ExtSession ?? "AH") + " " + Pct(it.ExtPct.Value), smallFont, c, x, fmt, measureOnly);
        }
        return x;
    }

    float DrawText(Graphics g, string s, Font f, Color c, float x, StringFormat fmt, bool measureOnly)
    {
        var size = g.MeasureString(s, f, 2000, fmt);
        if (!measureOnly) using (var b = new SolidBrush(c)) g.DrawString(s, f, b, x, TextY(g, f, fmt), fmt);
        return x + size.Width;
    }

    void Step()
    {
        long now = clock.ElapsedMilliseconds;
        float dt = (now - lastTick) / 1000f;
        lastTick = now;
        if (strip == null || hover || paused || dt <= 0 || dt > 0.5f) return;
        offset += SpeedPerSec * scale * dt;
        if (offset >= strip.Width) offset -= strip.Width;
        Invalidate(new Rectangle(boxW, 0, Width - boxW, barH));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Bg);
        if (strip != null && strip.Width > 1)
        {
            g.SetClip(new Rectangle(boxW, 0, Width - boxW, barH));
            float x = boxW - offset;
            while (x < Width) { g.DrawImageUnscaled(strip, (int)Math.Round(x), 0); x += strip.Width; }
            g.ResetClip();
        }
        // the fixed label on the left: name and when the quotes were last pulled (amber when they are old)
        using (var b = new SolidBrush(Bg)) g.FillRectangle(b, 0, 0, boxW, barH);
        using (var p = new Pen(Line)) { g.DrawLine(p, boxW - 1, 4 * scale, boxW - 1, barH - 4 * scale); g.DrawLine(p, 0, 0, Width, 0); }
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        var fmt = Typo;
        float x0 = 8 * scale;
        var age = DateTime.Now - updated;
        bool old = updated == DateTime.MinValue || age > Interval + Interval + TimeSpan.FromMinutes(1);
        x0 = DrawText(g, "BENCH", symFont, Txt, x0, fmt, false) + 5 * scale;
        DrawText(g, updated == DateTime.MinValue ? "--" : updated.ToString("h:mmt").ToLower(), smallFont, old ? Amber : Dim, x0, fmt, false);
    }

    void OnClick(object sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Left || strip == null || e.X < boxW || hits.Count == 0) return;
        float sx = (e.X - boxW + offset) % strip.Width;
        Item hit = null;
        foreach (var h in hits) if (h.Key <= sx) hit = h.Value;
        if (hit == null) return;
        var name = hit.Sym.EndsWith("-USD") ? hit.Sym.Substring(0, hit.Sym.Length - 4) : hit.Sym;
        var path = (hit.Crypto ? "crypto/" : "stocks/") + name;   // the feed says which names are coins
        try { Process.Start("https://robinhood.com/" + path); } catch { }
    }
}
