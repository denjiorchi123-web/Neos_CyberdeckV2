import tkinter as tk
import tkinter.font as tkfont
import sys
import math
import time
import urllib.request
import json


def navigate_to_chat(url):
    try:
        # Emit IPC message to navigate the UI
        data = json.dumps({"event": "ui:navigate", "data": {"url": url}}).encode("utf-8")
        req = urllib.request.Request(
            "http://127.0.0.1:3001/api/socket/internal-emit",
            data=data,
            headers={"Content-Type": "application/json"}
        )
        # Timeout of 2s to not hang the exit animation
        with urllib.request.urlopen(req, timeout=2) as response:
            pass
    except Exception as e:
        print("Failed to navigate:", e)


def main():
    if len(sys.argv) < 3:
        print("Usage: python notify.py <sender> <message> [target_url]")
        return

    sender  = sys.argv[1]
    message = sys.argv[2]
    target_url = sys.argv[3] if len(sys.argv) > 3 else None

    # ── Design tokens (messaging-app style) ──────────────────────────────────
    BG_OUTER   = "#000000"   # transparent placeholder
    CARD_BG    = "#1f2c34"   # dark teal-charcoal card (chat-app dark theme)
    AVATAR_BG  = "#00a884"   # teal-green avatar circle
    AVATAR_FG  = "#ffffff"
    NAME_FG    = "#00a884"   # teal-green sender name
    MSG_FG     = "#d1d7db"   # light grey message body
    TIME_FG    = "#8696a0"   # muted timestamp
    TICK_COLOR = "#53bdeb"   # double-tick blue
    REPLY_FG   = "#8696a0"
    DIVIDER    = "#2a3942"   # subtle separator
    SHADOW     = "#000000"

    W, H   = 380, 82
    PAD    = 12
    R      = 16             # card corner radius

    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    root.configure(bg=SHADOW)
    root.geometry(f"{W}x{H}+40+40")

    try:
        root.attributes("-transparentcolor", SHADOW)
    except Exception:
        pass

    canvas = tk.Canvas(root, width=W, height=H,
                       bg=SHADOW, highlightthickness=0)
    canvas.pack(fill=tk.BOTH, expand=True)

    # ── Rounded rect helper ───────────────────────────────────────────────────
    def rrect(x1, y1, x2, y2, r, **kw):
        pts = [
            x1+r,y1,  x2-r,y1,
            x2,y1,    x2,y1+r,
            x2,y2-r,  x2,y2,
            x2-r,y2,  x1+r,y2,
            x1,y2,    x1,y2-r,
            x1,y1+r,  x1,y1,
            x1+r,y1,
        ]
        return canvas.create_polygon(pts, smooth=True, **kw)

    # ── Shadow (slightly larger, offset) ─────────────────────────────────────
    rrect(3, 4, W-2, H-2, R, fill="#00000066", outline="")

    # ── Card ─────────────────────────────────────────────────────────────────
    rrect(0, 0, W-5, H-5, R, fill=CARD_BG, outline="")

    # ── Avatar circle ─────────────────────────────────────────────────────────
    AV_X, AV_Y, AV_R = PAD + 22, (H-5)//2, 20
    canvas.create_oval(AV_X-AV_R, AV_Y-AV_R, AV_X+AV_R, AV_Y+AV_R,
                       fill=AVATAR_BG, outline="")
    # Initials
    initials = "".join(w[0].upper() for w in sender.split()[:2]) or "?"
    canvas.create_text(AV_X, AV_Y, text=initials,
                       font=("Helvetica", 12, "bold"),
                       fill=AVATAR_FG)

    # ── Text block ────────────────────────────────────────────────────────────
    TX = AV_X + AV_R + 12   # text start x
    TY_NAME = 16
    TY_MSG  = 34
    TY_META = 54

    # Sender name
    canvas.create_text(TX, TY_NAME, text=sender,
                       font=("Helvetica", 10, "bold"),
                       fill=NAME_FG, anchor="w")

    # Message body – truncate if too long
    MAX_CHARS = 46
    display_msg = message if len(message) <= MAX_CHARS else message[:MAX_CHARS-1] + "…"
    canvas.create_text(TX, TY_MSG, text=display_msg,
                       font=("Helvetica", 9),
                       fill=MSG_FG, anchor="w")

    # Timestamp (right-aligned)
    now = time.strftime("%I:%M %p").lstrip("0")
    TIME_X = W - 5 - 12
    canvas.create_text(TIME_X, TY_NAME, text=now,
                       font=("Helvetica", 8),
                       fill=TIME_FG, anchor="e")

    # Double tick (✓✓) in blue
    canvas.create_text(TIME_X - 36, TY_NAME, text="✓✓",
                       font=("Helvetica", 8, "bold"),
                       fill=TICK_COLOR, anchor="e")

    # "Tap to reply" hint
    canvas.create_text(TX, TY_META, text="Tap to reply",
                       font=("Helvetica", 8),
                       fill=REPLY_FG, anchor="w")

    # Thin separator line at bottom area
    canvas.create_line(TX, TY_META - 8, W - 20, TY_META - 8,
                       fill=DIVIDER, width=1)

    # ── Slide-in / slide-out ─────────────────────────────────────────────────
    DURATION_MS = 5000
    alive = [True]

    def slide_in(y=-H, target=40):
        if y < target:
            root.geometry(f"{W}x{H}+40+{y}")
            root.after(8, lambda: slide_in(min(y + 7, target), target))
        else:
            root.geometry(f"{W}x{H}+40+{target}")
            root.after(DURATION_MS, slide_out)

    def slide_out(y=40):
        if not alive[0]:
            return
        if y > -(H + 10):
            root.geometry(f"{W}x{H}+40+{y}")
            root.after(8, lambda: slide_out(y - 8))
        else:
            alive[0] = False
            try:
                root.destroy()
            except Exception:
                pass

    def dismiss(*_):
        if alive[0]:
            alive[0] = False
            slide_out()

    # Drag to reposition
    _d = {"x": 0, "y": 0, "moved": False}
    
    def on_press(e):
        _d["x"] = e.x
        _d["y"] = e.y
        _d["moved"] = False
        
    def on_drag(e):
        dx = abs(e.x - _d["x"])
        dy = abs(e.y - _d["y"])
        if dx > 5 or dy > 5:
            _d["moved"] = True
        root.geometry(f"+{root.winfo_x()+e.x-_d['x']}+{root.winfo_y()+e.y-_d['y']}")

    def on_release(e):
        if not _d["moved"]:
            if target_url:
                navigate_to_chat(target_url)
            dismiss()

    canvas.bind("<ButtonPress-1>", on_press)
    canvas.bind("<B1-Motion>",     on_drag)
    canvas.bind("<ButtonRelease-1>", on_release)

    slide_in()
    root.mainloop()


if __name__ == "__main__":
    main()
