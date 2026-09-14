import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const [open, setOpen] = useState(false);

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
    return (
      <>
        <Pressable onPress={() => setOpen(true)}>
          <Image source={{ uri: src }} style={{ width: '100%', height: 200, borderRadius: 10, marginVertical: 6 }} contentFit="contain" />
        </Pressable>
        <ImageViewer visible={open} source={{ uri: src }} onClose={() => setOpen(false)} />
      </>
    );
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

  const source = {
    uri: `https://${link.host}/v1/spaces/${encodeURIComponent(link.spaceId)}/blobs/${link.hash}`,
    headers: { authorization: `Bearer ${token}` },
  };
  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <Image
          source={source}
          style={{ width, height, borderRadius: 10, marginVertical: 6, backgroundColor: colors.secondaryBackground }}
          contentFit="cover"
          transition={120}
        />
      </Pressable>
      <ImageViewer visible={open} source={source} onClose={() => setOpen(false)} />
    </>
  );
}

// Full-screen viewer: black ground, pinch-to-zoom (the native scroll view's
// zoom), tap or × to close — the Photos/iMessage lightbox.
function ImageViewer({ visible, source, onClose }: { visible: boolean; source: { uri: string; headers?: Record<string, string> }; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ width, height }}
          minimumZoomScale={1}
          maximumZoomScale={4}
          bouncesZoom
          centerContent
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          <Pressable onPress={onClose} style={{ width, height }}>
            <Image source={source} style={{ width, height }} contentFit="contain" />
          </Pressable>
        </ScrollView>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={{
            position: 'absolute', top: insets.top + 8, right: 16, width: 34, height: 34, borderRadius: 17,
            alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        >
          <Image source="sf:xmark" style={{ width: 14, height: 14 }} tintColor="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}
