import { useEvent } from 'expo';
import type { File } from 'expo-file-system';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { Image as SymbolImage } from '@/components/sf-image';
import { parseBlobLink } from '@/components/space-blob-image';
import { useSpacesAccount } from '@/lib/spaces/account';
import { friendlyError } from '@/lib/spaces/errors';
import { downloadBlob } from '@/lib/spaces/open-blob';
import { useColors } from '@/theme/colors';

/**
 * A video blob with the system player (2026-11-07). It downloads first (the
 * blob route has no byte ranges to stream from), so it shows a spinner until
 * the file is on the phone, then the first frame, paused: it plays when the
 * play button is hit, as Slack and iMessage do. `onReady` hands the local
 * file up, for sharing or saving.
 */
export function BlobVideo({ org, spaceId, hash, name, onReady, dark = true }: {
  org: string;
  spaceId: string;
  hash: string;
  name: string;
  onReady?: (file: File) => void;
  /** White text on black (the full-screen player); off follows the theme. */
  dark?: boolean;
}) {
  const colors = useColors();
  const account = useSpacesAccount();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const text = dark ? '#fff' : colors.label;

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one download per blob (and per retry)
  }, [org, spaceId, hash, name, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
        <Text style={{ fontSize: 15, color: text, textAlign: 'center' }}>{"Couldn't load the video"}</Text>
        <Pressable onPress={retry} hitSlop={10}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: text }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!file) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={text} />
      </View>
    );
  }
  return <Player uri={file.uri} />;
}

// The system controls stay hidden until the video is touched, so until it
// first plays a play button sits over the frame, as in Slack.
function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (isPlaying) setStarted(true);
  }, [isPlaying]);
  return (
    <View style={{ flex: 1 }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />
      {started ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play video"
          onPress={() => player.play()}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <SymbolImage source="sf:play.fill" style={{ width: 22, height: 22, marginLeft: 3 }} contentFit="contain" tintColor="#fff" />
          </View>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A video attached to a message, in the message like an image (2026-11-07):
 * the first frame with the player's controls, at the message column's width.
 * Links carry no dimensions for videos, so the box is 16:9 and the frame fits
 * inside it.
 */
export function MessageVideo({ src, name }: { src: string; name: string }) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const link = parseBlobLink(src);
  if (!link) return null;
  const width = Math.min(screenWidth - 76, 420);
  const aspect = link.dims ? link.dims.width / link.dims.height : 16 / 9;
  return (
    <View style={{ marginVertical: 6, gap: 4 }}>
      <View style={{ width, height: width / aspect, borderRadius: 10, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#000' }}>
        <BlobVideo org={link.host} spaceId={link.spaceId} hash={link.hash} name={name} />
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.secondaryLabel, maxWidth: width }}>{name}</Text>
    </View>
  );
}
