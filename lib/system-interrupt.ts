import { exec } from "child_process";

let lastInterrupt = 0;

export function triggerSystemInterrupt(event: string = "unknown", data: any = {}) {
  const now = Date.now();
  // Prevent spamming interrupts (cooldown of 2 seconds)
  if (now - lastInterrupt < 2000) return;
  lastInterrupt = now;

  console.log(`[Interrupt] Network packet received (${event}). Checking UI status...`);

  const isCall = event === "webrtc:offer" || event === "webrtc:call" || event === "call:start";
  
  const fromName = data?.fromUsername || data?.member?.profile?.name || data?.callerName || "Someone";
  const title = isCall ? "Incoming Call" : "New Message";
  const body = isCall ? `${fromName} is calling you` : `${fromName} sent a message`;

  // Play a system sound immediately!
  // paplay uses PulseAudio, typical on Pi OS Bookworm
  const soundCmd = `sudo -u nova env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus paplay /usr/share/sounds/freedesktop/stereo/message-new-instant.oga || sudo -u nova env XDG_RUNTIME_DIR=/run/user/1000 paplay /usr/share/sounds/freedesktop/stereo/message.oga || sudo -u nova env XDG_RUNTIME_DIR=/run/user/1000 aplay /usr/share/sounds/alsa/Front_Center.wav`;
  exec(soundCmd, () => {});

  // Send an OS-level desktop notification
  const notifyEnv = "XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus DISPLAY=:0";
  const notifyCmd = `sudo -u nova env WAYLAND_DISPLAY=wayland-1 ${notifyEnv} notify-send "CyberDeck - ${title}" "${body}" -u critical -t 5000 || sudo -u nova env WAYLAND_DISPLAY=wayland-0 ${notifyEnv} notify-send "CyberDeck - ${title}" "${body}" -u critical -t 5000`;
  exec(notifyCmd, () => {});

  // Only force-launch the UI full-screen if it's an incoming CALL!
  if (isCall) {
    exec("pgrep chromium", (err) => {
      // If err is truthy (exit code 1), pgrep found NOTHING. Chromium is closed!
      if (err) {
        const urlParams = `?incomingCall=1&callId=${data.callId || ''}&chatId=${data.chatId || ''}&callerName=${encodeURIComponent(fromName)}&callType=${data.type || 'audio'}`;
        console.log("[Interrupt] UI is closed! Force waking OS screen for incoming call...");
        const launchCmd = `sudo -u nova env WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:0 chromium --kiosk "http://127.0.0.1:3001/launcher${urlParams}" --ozone-platform=wayland --enable-features=UseOzonePlatform --touch-events=enabled --enable-multitouch --enable-gpu-rasterization --enable-zero-copy --disable-pinch --overscroll-history-navigation=0 --ignore-certificate-errors --test-type --force-device-scale-factor=0.75 --password-store=basic --fast --fast-start || sudo -u nova env WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:0 chromium --kiosk "http://127.0.0.1:3001/launcher${urlParams}" --ozone-platform=wayland --enable-features=UseOzonePlatform --touch-events=enabled --enable-multitouch --enable-gpu-rasterization --enable-zero-copy --disable-pinch --overscroll-history-navigation=0 --ignore-certificate-errors --test-type --force-device-scale-factor=0.75 --password-store=basic --fast --fast-start`;
        
        exec(launchCmd, (launchErr) => {
          if (launchErr) console.error("[Interrupt] Failed to wake OS screen:", launchErr);
        });
      } else {
         console.log("[Interrupt] UI is already active.");
      }
    });
  }
}
