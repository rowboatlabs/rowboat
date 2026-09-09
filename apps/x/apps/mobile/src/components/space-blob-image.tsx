import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { useColors } from '@/theme/colors';

// Message bodies reference uploads as canonical wire links
// (https://<org>/s/<spaceId>/b/<sha256>?name=…&w=…&h=…). The short form isn't
// a servable route — the bytes live behind the authed API route — so this
// component swaps the URL and rides a bearer on the request (expo-image
// forwards source.headers).
const BLOB_LINK = /^https?:\/\/([^/]+)\/s\/([^/?#]+)\/b\/([0-9a-f]{64})(?:\?([^#]*))?/;

export function parseBlobLink(src: string): { host: string; spaceId: string; hash: string; dims: { width: number; height: number } | null } | null {
  const m = BLOB_LINK.exec(src);
  if (!m) return null;
  const params = new URLSearchParams(m[4] ?? '');
  const width = Number(params.get('w'));
  const height = Number(params.get('h'));
  const dims = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
  return { host: m[1], spaceId: decodeURIComponent(m[2]), hash: m[3], dims };
}

export function SpaceBlobImage({ src }: { src: string }) {
  const colors = useColors();
  const account = useSpacesAccount();
  const { width: screenWidth } = useWindowDimensions();
  const [token, setToken] = useState<string | null>(null);

  const link = parseBlobLink(src);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    account
      .getAccessToken()
      .then((t) => !cancelled && setToken(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one token per mount; expiry is ~1h, image loads once
  }, [src]);

  if (!link) {
    // Non-blob image (external URL) — plain render.
    return <Image source={{ uri: src }} style={{ width: '100%', height: 200, borderRadius: 10, marginVertical: 6 }} contentFit="contain" />;
  }

  // Message column ≈ screen minus avatar gutter + paddings; w/h hints give the
  // exact box so the layout never jumps when bytes land.
  const maxWidth = screenWidth - 76;
  const aspect = link.dims ? link.dims.width / link.dims.height : 4 / 3;
  const width = link.dims ? Math.min(link.dims.width, maxWidth) : maxWidth;
  const height = width / aspect;

  if (!token) {
    return <View style={{ width, height, borderRadius: 10, marginVertical: 6, backgroundColor: colors.secondaryBackground }} />;
  }

  return (
    <Image
      source={{
        uri: `https://${link.host}/v1/spaces/${encodeURIComponent(link.spaceId)}/blobs/${link.hash}`,
        headers: { authorization: `Bearer ${token}` },
      }}
      style={{ width, height, borderRadius: 10, marginVertical: 6, backgroundColor: colors.secondaryBackground }}
      contentFit="cover"
      transition={120}
    />
  );
}
