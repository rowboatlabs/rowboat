import type { SpacesClient } from "@x/core/dist/spaces/client.js";
import * as orgs from "@x/core/dist/spaces/orgs.js";
import { forwardRpc } from "../rpc-forwarder.js";
import { serverHostMode } from "../server-host.js";

// Space reads main makes for itself — a document served to a webview, a file
// saved to disk — outside the renderer's IPC. With a remote server (a Baarali
// cloud instance, 2026-10-02) the org registry and its credentials are the
// server's: the reads go through its RPC, the same channels the renderer's
// calls are forwarded to, never through an org this machine does not hold.

type ReadAssetResult = Awaited<ReturnType<SpacesClient["readAsset"]>>;
type AssetEntry = Awaited<ReturnType<SpacesClient["listAssets"]>>[number];

export async function readSpaceAsset(orgId: string, spaceId: string, assetId: string): Promise<ReadAssetResult> {
  if (serverHostMode() !== "remote") return orgs.getClient(orgId).readAsset(spaceId, assetId);
  return (await forwardRpc("spaces:readAsset", { orgId, spaceId, assetId })) as ReadAssetResult;
}

export async function listSpaceAssets(orgId: string, spaceId: string): Promise<AssetEntry[]> {
  if (serverHostMode() !== "remote") return orgs.getClient(orgId).listAssets(spaceId);
  return ((await forwardRpc("spaces:listAssets", { orgId, spaceId })) as { entries: AssetEntry[] }).entries;
}
