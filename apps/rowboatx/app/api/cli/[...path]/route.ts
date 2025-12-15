import { NextRequest } from "next/server";

const BACKEND = process.env.CLI_BACKEND_URL || "http://localhost:3000";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function forward(req: NextRequest, method: string, segments?: string[]) {
  const search = req.nextUrl.search || "";
  const targetPath = (segments || []).join("/");
  const target = `${BACKEND}/${targetPath}${search}`;

  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": req.headers.get("content-type") || "application/json",
    },
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = await req.text();
  }

  const res = await fetch(target, init);
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json",
      ...CORS_HEADERS,
    },
  });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, "GET", path);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, "POST", path);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, "PUT", path);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await context.params;
  return forward(req, "DELETE", path);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
