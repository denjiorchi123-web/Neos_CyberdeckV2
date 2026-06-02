import { NextResponse } from "next/server";

function retiredRoute() {
  return NextResponse.json({
    retired: true,
    message: "Unsigned HTTP pairing callbacks are retired. Use the signed TCP mesh handshake on port 5006.",
  });
}

export const GET = retiredRoute;
export const POST = retiredRoute;
