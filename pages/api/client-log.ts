import { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    const { level, message, data } = req.body;
    console.log(`[CLIENT ${level?.toUpperCase() || 'INFO'}] ${message}`, data || "");
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ error: "Method not allowed" });
}
