import tkinter as tk
import sys

def main():
    if len(sys.argv) < 3:
        return
        
    title = sys.argv[1]
    body = sys.argv[2]

    root = tk.Tk()
    
    # Remove window decorations (borderless)
    root.overrideredirect(True)
    
    # Keep on top of all other windows
    root.attributes('-topmost', True)
    
    # Background color (CyberDeck Dark Theme)
    bg_color = "#0d0f14"
    border_color = "#34d399" # Emerald green accent
    
    root.configure(bg=border_color)
    
    # Position top-right (assuming 1080p or 720p screen, we'll anchor it to coordinates roughly near top center/right)
    # +20 from top, +20 from left. If we want it top-right, we can use negative geometry if the WM supports it,
    # but +40+40 is universally safe to ensure it's visible.
    root.geometry("350x80+40+40")

    # Inner frame for the border effect
    inner = tk.Frame(root, bg=bg_color)
    inner.pack(fill=tk.BOTH, expand=True, padx=2, pady=2)

    # Title label
    lbl_title = tk.Label(inner, text=title, font=("Helvetica", 11, "bold"), fg=border_color, bg=bg_color)
    lbl_title.pack(anchor="w", padx=15, pady=(12, 2))

    # Body label
    lbl_body = tk.Label(inner, text=body, font=("Helvetica", 10), fg="#a1a1aa", bg=bg_color)
    lbl_body.pack(anchor="w", padx=15, pady=(0, 10))

    # Auto-destroy after 5 seconds
    root.after(5000, root.destroy)
    
    # Handle clicks to dismiss early
    inner.bind("<Button-1>", lambda e: root.destroy())
    lbl_title.bind("<Button-1>", lambda e: root.destroy())
    lbl_body.bind("<Button-1>", lambda e: root.destroy())

    root.mainloop()

if __name__ == "__main__":
    main()
