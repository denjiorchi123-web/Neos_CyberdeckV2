import "server-only";

import net from "net";
import { MESH_CONTROL_PORT, signedControlMessage } from "@/lib/mesh-identity";

export async function sendMeshControl(
  ip: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const packet = JSON.stringify(signedControlMessage(payload)) + "\n";

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: MESH_CONTROL_PORT });
    const timeout = setTimeout(() => socket.destroy(new Error("Mesh control timeout")), 5000);

    socket.once("connect", () => socket.end(packet));
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      clearTimeout(timeout);
      if (!hadError) resolve();
    });
  });
}
