import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

const AGENTS_ROOT = path.join(os.homedir(), ".rowboat", "agents");

function resolveAgentPath(fileParam: string): { target: string; relative: string } {
  // Normalize and strip any attempted path traversal.
  const normalized = path.normalize(fileParam).replace(/^(\.\.(\/|\\|$))+/, "");
  const target = path.join(AGENTS_ROOT, normalized);
  if (!target.startsWith(AGENTS_ROOT)) {
    throw new Error("Invalid path");
  }
  return { target, relative: normalized };
}

export async function GET(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get("file");
  if (!fileParam) {
    return Response.json({ error: "file param required" }, { status: 400 });
  }

  try {
    const { target, relative } = resolveAgentPath(fileParam);
    const content = await fs.readFile(target, "utf8");
    return Response.json({ file: relative, content, raw: content });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "Invalid path") {
      return Response.json({ error: "Invalid file path" }, { status: 400 });
    }
    console.error("Failed to read agent file", error);
    return Response.json({ error: "Failed to read agent file" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get("file");
  if (!fileParam) {
    return Response.json({ error: "file param required" }, { status: 400 });
  }

  try {
    const { target, relative } = resolveAgentPath(fileParam);
    const content = await req.text();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    return Response.json({ file: relative, success: true });
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "Invalid path") {
      return Response.json({ error: "Invalid file path" }, { status: 400 });
    }
    console.error("Failed to write agent file", error);
    return Response.json({ error: "Failed to write agent file" }, { status: 500 });
  }
}
