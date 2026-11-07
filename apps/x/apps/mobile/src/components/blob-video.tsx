import type { File } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { friendlyError } from '@/lib/spaces/errors';
import { downloadBlob } from '@/lib/spaces/open-blob';

/**
 * A video blob, played in place with the system controls (2026-11-07). It
 * downloads first (the blob route has no byte ranges to stream from), so the
 * player shows a spinner until the file is on the phone. `onReady` hands the
 * local file up, for sharing or saving.
 */
export function BlobVideo({ org, spaceId, hash, name, onReady }: {
  org: string;
  spaceId: string;
  hash: string;
  name: string;
  onReady?: (file: File) => void;
}) {
  const account = useSpacesAccount();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);
    account
      .getAccessToken()
      .then((token) => downloadBlob(org, spaceId, hash, name, token))
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        onReady?.(f);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, "You're offline. Try again when you're back online."));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one download per blob
  }, [org, spaceId, hash, name]);

  useEffect(() => load(), [load]);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Text style={{ fontSize: 15, color: '#fff', textAlign: 'center' }}>{"Couldn't load the video"}</Text>
        <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>{error}</Text>
        <Pressable onPress={load} hitSlop={10}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!file) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return <Player uri={file.uri} />;
}

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />;
}
