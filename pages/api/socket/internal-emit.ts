import { NextApiRequest } from "next";
import { NextApiResponseServerIo } from "@/types";
import ioHandler from "@/pages/api/socket/io";

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIo) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const remoteAddress = req.socket.remoteAddress;
  const isLocal = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (!isLocal) {
    console.warn(`[SocketIPC] Unauthorized external emit attempt from IP: ${remoteAddress}`);
    return res.status(403).json({ error: "Forbidden: Localhost only" });
  }

  const { channel, event, data } = req.body;
  if (!event) {
    return res.status(400).json({ error: "Missing event" });
  }

  let io = (global as any).nextIo || res.socket?.server?.io;

  if (!io) {
    console.log("[SocketIPC] io not found, initializing ioHandler...");
    ioHandler(req, res);
    io = (global as any).nextIo || res.socket?.server?.io;
  }

  if (io) {
    const clients = io.sockets.sockets.size;
    const roomSize = channel ? (io.sockets.adapter.rooms.get(channel)?.size || 0) : 0;
    console.log(`[SocketIPC] Emitting event '${event}' to channel '${channel}'. Connected clients: ${clients}, Clients in room: ${roomSize}`);
    
    // Log all rooms for debugging
    const allRooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => !io.sockets.sockets.has(r));
    console.log(`[SocketIPC] Active custom rooms: ${allRooms.join(", ")}`);

    if (channel) {
      io.to(channel).emit(event, data);
    } else {
      io.emit(event, data);
    }
    return res.status(200).json({ success: true, clients, roomSize });
  }

  return res.status(500).json({ error: "Socket server not initialized" });
}
