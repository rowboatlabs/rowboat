import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, Text, useWindowDimensions } from 'react-native';

import { ChatMarkdown } from '@/components/markdown';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { SpacesLive } from '@/lib/spaces/live';
import { useColors } from '@/theme/colors';

// One file, read-only (S3): markdown rendered like chat, other text in mono,
// images from the blob store. Changesets touching this path refresh it live.
export default function SpaceFileScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ org: string; space: string; path: string; title: string; mime: string }>();
  const { org, space, path, title, mime } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  const [content, setContent] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await client.readAsset(space, path);
        if (cancelled) return;
        if (result.blob) {
          // Binary: images render inline; anything else just states itself.
          const token = await account.getAccessToken();
          if (result.blob.mime.startsWith('image/')) {
            setImageUri({
              uri: `https://${org}/v1/spaces/${encodeURIComponent(space)}/blobs/${result.blob.hash}`,
              headers: { Authorization: `Bearer ${token}` },
            });
          } else {
            setError(`${result.blob.mime} — no preview on the phone yet`);
          }
        } else {
          setContent(result.content);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();

    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(space, (frame) => {
      if (frame.kind === 'event' && frame.event.type === 'change' && frame.event.changeSet.assetPath === path) void load();
    });
    return () => {
      cancelled = true;
      off();
      live.close();
    };
  }, [client, account, org, space, path]);

  const markdown = path.endsWith('.md') || path.endsWith('.markdown');
  const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Stack.Screen options={{ title: title ?? path }} />
      {error ? <Text style={{ fontSize: 13, color: colors.destructive }}>{error}</Text> : null}
      {content === null && imageUri === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {imageUri ? (
        <Image source={imageUri} style={{ width: width - 32, height: width - 32, borderRadius: 10 }} resizeMode="contain" />
      ) : null}
      {content !== null ? (
        markdown ? (
          <ChatMarkdown>{content}</ChatMarkdown>
        ) : (
          <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 19, color: colors.label }}>
            {content}
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}
