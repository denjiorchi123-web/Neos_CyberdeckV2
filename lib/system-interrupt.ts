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

  // Resolve targetUrl
  let targetUrl = "/";
  const sId = data?.serverId || data?.member?.serverId;
  const cId = data?.channelId;
  const mId = data?.member?.id || data?.conversationId;

  if (sId && cId) {
    targetUrl = `/servers/${sId}/channels/${cId}`;
  } else if (sId && mId) {
    targetUrl = `/servers/${sId}/conversations/${mId}`;
  } else if (data?.chatId || data?.conversationId) {
    targetUrl = `/chat/${data.chatId || data.conversationId}`;
  }

  // Escape arguments for command line execution
  const msgContent = data?.content || data?.body || (isCall ? "Incoming Call" : "New Message");
  const escapedName = fromName.replace(/"/g, '\\"');
  const escapedMsg = msgContent.replace(/"/g, '\\"');

  // Trigger our custom python tkinter notification card
  const pythonCmd = `PID=\\$(pgrep -u nova chromium-browser | head -n 1 || pgrep -u nova chromium | head -n 1 || pgrep -u nova labwc | head -n 1 || pgrep -u nova wayfire | head -n 1 || echo ""); if [ -n "\\$PID" ]; then eval \\$(cat /proc/\\$PID/environ | tr '\\\\0' '\\\\n' | grep -E '^(WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS)='); fi; export WAYLAND_DISPLAY DISPLAY XDG_RUNTIME_DIR XAUTHORITY DBUS_SESSION_BUS_ADDRESS; CMD="python3 /opt/cyberdeck/scripts/notify.py \\"${escapedName}\\" \\"${escapedMsg}\\" \\"${targetUrl}\\""; if [ \\$(id -u) -eq 0 ]; then CMD="sudo -u nova -E \\$CMD"; fi; eval \\$CMD > /tmp/notify.log 2>&1`;

  exec(pythonCmd, (err) => {
    if (err) {
      console.error("[Interrupt] Failed to trigger python notification:", err);
    }
  });

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
