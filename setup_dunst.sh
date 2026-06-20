#!/bin/bash
mkdir -p ~/.config/dunst

cat << 'EOF' > ~/.config/dunst/dunstrc
[global]
    width = 320
    height = 80
    origin = top-center
    offset = 0x24
    mouse_left_click = do_action, close_current
    frame_width = 2
    frame_color = "#4f46e5"
    font = Monospace 11
    corner_radius = 12
    background = "#09090b"
    foreground = "#ffffff"
    timeout = 5
    icon_position = left
    max_icon_size = 48
    format = "<b>%s</b>\n%b"

[urgency_low]
    background = "#09090b"
    foreground = "#a1a1aa"
    timeout = 3

[urgency_normal]
    background = "#09090b"
    foreground = "#ffffff"
    timeout = 5

[urgency_critical]
    background = "#27272a"
    foreground = "#ffffff"
    frame_color = "#e11d48"
    timeout = 10
EOF

killall dunst || true
echo "Dunst configured successfully!"

cd ~/CyberDeck_AirGappedOS
git pull
# Check if we need to restart Next.js (if it is running via PM2 or systemd)
pm2 restart all || echo "PM2 not found or not managing the app, you may need to restart the server manually."
