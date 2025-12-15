import { NextRequest } from "next/server";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

const ROWBOAT_ROOT = path.join(os.homedir(), ".rowboat", "runs");

export async function GET(req: NextRequest) {
  const fileParam = req.nextUrl.searchParams.get("file");
  if (!fileParam) {
    return Response.json({ error: "file param required" }, { status: 400 });
  }

  // Prevent path traversal: only allow basenames.
  const safeName = path.basename(fileParam);
  const target = path.join(ROWBOAT_ROOT, safeName);

  try {
    const content = await fs.readFile(target, "utf8");
    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    return Response.json({ file: safeName, parsed, raw: content });
  } catch (error: any) {
    console.error("Failed to read run file", error);
    return Response.json(
      { error: "Failed to read run file" },
      { status: 500 }
    );
  }
}
