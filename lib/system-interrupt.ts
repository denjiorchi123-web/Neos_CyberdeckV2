import { exec, execFile } from "child_process";

let lastInterrupt = 0;

const NOVA_ENV = {
  WAYLAND_DISPLAY: "wayland-0",
  DISPLAY: ":0",
  XDG_RUNTIME_DIR: "/run/user/1000",
  DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus"
};

export function triggerSystemInterrupt(event: string = "unknown", data: any = {}) {
  if (process.platform === "win32") return;
  const now = Date.now();
  // Prevent spamming interrupts (cooldown of 2 seconds)
  if (now - lastInterrupt < 2000) return;
  lastInterrupt = now;

  console.log(`[Interrupt] Network packet received (${event}). Checking UI status...`);

  const isCall = event === "webrtc:offer" || event === "webrtc:call" || event === "call:start";
  
  const fromName = String(data?.fromUsername || data?.member?.profile?.name || data?.callerName || "Someone");
  const title = isCall ? "Incoming Call" : "New Message";
  const body = isCall ? `${fromName} is calling you` : `${fromName} sent a message`;
  const msgContent = String(data?.content || data?.body || (isCall ? "Incoming Call" : "New Message"));

  // Determine current user to see if we need sudo
  exec("id -un", (err, stdout) => {
    if (err) {
      console.error("[Interrupt] Failed to check current user name:", err);
    }
    const currentUser = stdout.trim() || "cyberdeck";
    const useSudo = currentUser !== "nova";
    const childEnv = { ...process.env, ...NOVA_ENV };

    // 1. Play a system sound immediately!
    const playSound = (cmdName: string, args: string[], fallback: () => void) => {
      let cmd = cmdName;
      let cmdArgs = args;
      if (useSudo) {
        cmd = "sudo";
        cmdArgs = ["-u", "nova", "-E", cmdName, ...args];
      }
      execFile(cmd, cmdArgs, { env: childEnv }, (soundErr) => {
        if (soundErr) fallback();
      });
    };

    playSound("paplay", ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"], () => {
      playSound("paplay", ["/usr/share/sounds/freedesktop/stereo/message.oga"], () => {
        playSound("aplay", ["/usr/share/sounds/alsa/Front_Center.wav"], () => {});
      });
    });

    // 2. Resolve targetUrl
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

    // 3. Send OS-level desktop notification using notify-send
    const notifyArgs = [
      "-i", "message-new",
      `CyberDeck - ${fromName}`,
      msgContent,
      "-u", "critical",
      "-t", "5000",
      "--action=default=Open",
      "-w"
    ];

    let notifyCmd = "notify-send";
    let notifyCmdArgs = notifyArgs;
    if (useSudo) {
      notifyCmd = "sudo";
      notifyCmdArgs = ["-u", "nova", "-E", "notify-send", ...notifyArgs];
    }

    execFile(notifyCmd, notifyCmdArgs, { env: childEnv }, (notifyErr, notifyStdout) => {
      if (notifyErr) {
        console.error("[Interrupt] Failed to send OS notification:", notifyErr);
      }
      if (notifyStdout && notifyStdout.trim() === "default") {
        console.log("[Interrupt] Notification clicked! Navigating to chat...");
        // Emit IPC message to navigate the UI via local HTTP port 3001
        fetch("http://127.0.0.1:3001/api/socket/internal-emit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "ui:navigate", data: { url: targetUrl } })
        }).catch(e => console.error("[Interrupt] Failed to emit UI navigation:", e));
      }
    });

    // 4. Only force-launch the UI full-screen if it's an incoming CALL!
    if (isCall) {
      exec("pgrep chromium", (pgrepErr) => {
        // If pgrepErr is truthy (exit code 1), pgrep found NOTHING. Chromium is closed!
        if (pgrepErr) {
          const urlParams = `?incomingCall=1&callId=${data.callId || ''}&chatId=${data.chatId || ''}&callerName=${encodeURIComponent(fromName)}&callType=${data.type || 'audio'}`;
          console.log("[Interrupt] UI is closed! Force waking OS screen for incoming call...");
          
          const launchArgs = [
            "-u", "nova", "-E", "chromium",
            "--kiosk", `https://127.0.0.1:3000/launcher${urlParams}`,
            "--user-data-dir=/home/nova/.cyberdeck-kiosk", "--no-first-run", "--no-default-browser-check",
            "--ozone-platform=wayland", "--enable-features=UseOzonePlatform",
            "--touch-events=enabled", "--enable-multitouch", "--enable-gpu-rasterization",
            "--enable-zero-copy", "--disable-pinch", "--overscroll-history-navigation=0",
            "--ignore-certificate-errors", "--test-type", "--force-device-scale-factor=0.75",
            "--password-store=basic", "--fast", "--fast-start"
          ];
          
          // Try wayland-1 first, fallback to wayland-0
          const launchEnv1 = { ...childEnv, WAYLAND_DISPLAY: "wayland-1" };
          execFile("sudo", launchArgs, { env: launchEnv1 }, (launchErr1) => {
            if (launchErr1) {
              const launchEnv0 = { ...childEnv, WAYLAND_DISPLAY: "wayland-0" };
              execFile("sudo", launchArgs, { env: launchEnv0 }, (launchErr2) => {
                if (launchErr2) {
                  console.error("[Interrupt] Failed to wake OS screen:", launchErr2);
                }
              });
            }
          });
        } else {
          console.log("[Interrupt] UI is already active.");
        }
      });
    }
  });
}
