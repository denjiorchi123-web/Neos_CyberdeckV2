import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({
    retired: true,
    message: "Unsigned HTTP pairing callbacks are retired. Use the signed TCP mesh handshake on port 5006.",
  });
}
