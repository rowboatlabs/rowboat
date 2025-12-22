import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

const ROWBOAT_ROOT = path.join(os.homedir(), ".rowboat", "runs");

function resolveRunPath(fileParam: string): { target: string; relative: string } {
  const normalized = path.normalize(fileParam).replace(/^(\.\.(\/|\\|$))+/, "");
  const target = path.join(ROWBOAT_ROOT, normalized);
  if (!target.startsWith(ROWBOAT_ROOT)) {
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
    const { target, relative } = resolveRunPath(fileParam);
    const content = await fs.readFile(target, "utf8");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    return Response.json({ file: relative, parsed, raw: content });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Invalid path") {
      return Response.json(
        { error: "Invalid file path" },
        { status: 400 }
      );
    }
    console.error("Failed to read run file", error);
    return Response.json(
      { error: "Failed to read run file" },
      { status: 500 }
    );
  }
}
