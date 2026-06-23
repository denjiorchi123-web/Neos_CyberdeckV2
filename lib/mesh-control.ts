import net from "net";
import { MESH_CONTROL_PORT, signedControlMessage } from "@/lib/mesh-identity";

const MESH_CONTROL_TIMEOUT_MS = Number(process.env.MESH_CONTROL_TIMEOUT_MS || 30_000);

export async function sendMeshControl(
  ip: string,
  payload: Record<string, unknown>,
  timeoutMs = MESH_CONTROL_TIMEOUT_MS,
): Promise<void> {
  const host = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const packet = JSON.stringify(signedControlMessage(payload)) + "\n";

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port: MESH_CONTROL_PORT });
    let response = "";
    let settled = false;

    const settle = (error?: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };

    const timeout = setTimeout(() => {
      const error = new Error(`Mesh control timeout to ${host}:${MESH_CONTROL_PORT}`) as Error & { code?: string };
      error.code = "ETIMEDOUT";
      settle(error);
      socket.destroy();
    }, timeoutMs);

    socket.setNoDelay(true);
    socket.once("connect", () => socket.end(packet));
    socket.on("data", (chunk) => {
      if (response.length < 4096) response += chunk.toString("utf8");
    });
    socket.once("end", () => {
      const reply = response.trim();
      if (reply.startsWith("ERR")) {
        const error = new Error(reply.slice(3).trim() || "Mesh peer rejected the control packet") as Error & { code?: string };
        error.code = "EREMOTE";
        settle(error);
      } else {
        settle();
      }
    });
    socket.once("error", settle);
    socket.once("close", (hadError) => {
      if (!settled && hadError) {
        const error = new Error(`Mesh control socket to ${host}:${MESH_CONTROL_PORT} closed with error`) as Error & { code?: string };
        error.code = "ECONNRESET";
        settle(error);
      } else if (!settled) {
        // Compatibility with older peers that close without an explicit reply.
        settle();
      }
    });
  });
}
