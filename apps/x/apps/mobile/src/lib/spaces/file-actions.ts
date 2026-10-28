// The contract's canonical file link (https://<org>/s/<space>/a/<id>); in a
// message it reads as the file's name. The actions on it live in
// components/file-action-sheet.tsx.
export function fileLink(org: string, space: string, assetId: string): string {
  return `https://${org}/s/${space}/a/${encodeURIComponent(assetId)}`;
}
