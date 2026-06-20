import net from "net";
import { MESH_CONTROL_PORT, signedControlMessage } from "@/lib/mesh-identity";

export async function sendMeshControl(
  ip: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const host = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const packet = JSON.stringify(signedControlMessage(payload)) + "\n";

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port: MESH_CONTROL_PORT });
    const timeout = setTimeout(() => {
      socket.destroy(new Error("Mesh control timeout"));
      reject(new Error("Mesh control timeout"));
    }, 5000);

    socket.once("connect", () => socket.end(packet));
    socket.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    socket.once("close", (hadError) => {
      clearTimeout(timeout);
      if (!hadError) resolve();
      else reject(new Error("Mesh control socket closed with error"));
    });
  });
}
