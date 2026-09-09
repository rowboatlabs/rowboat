import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { fetchLinkPreview, previewUrls, type LinkPreview } from '@/lib/spaces/link-preview';
import { useColors } from '@/theme/colors';

// Slack-style unfurls under a message: gray accent bar, favicon + site name,
// the title as a link, the description, the og:image below. Tap opens the
// link. Nothing renders until the fetch answers with something card-worthy.

export const MessageLinkPreviews = memo(function MessageLinkPreviews({ body }: { body: string }) {
  const urls = previewUrls(body);
  if (urls.length === 0) return null;
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} />
      ))}
    </View>
  );
});

function LinkPreviewCard({ url }: { url: string }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLinkPreview(url).then((p) => !cancelled && setPreview(p));
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;
  const imageWidth = Math.min(width - 90, 340);

  return (
    <Pressable
      onPress={() => void Linking.openURL(preview.url)}
      style={{ flexDirection: 'row', gap: 10 }}
    >
      {/* Accent bar */}
      <View style={{ width: 4, borderRadius: 2, backgroundColor: colors.separator }} />
      <View style={{ flex: 1, gap: 3, paddingVertical: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {preview.favicon ? (
            <Image source={{ uri: preview.favicon }} style={{ width: 16, height: 16, borderRadius: 3 }} />
          ) : null}
          {preview.siteName ? (
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: colors.label }}>
              {preview.siteName}
            </Text>
          ) : null}
        </View>
        {preview.title ? (
          <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '600', color: '#0a84ff' }}>
            {preview.title}
          </Text>
        ) : null}
        {preview.description ? (
          <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 19, color: colors.secondaryLabel }}>
            {preview.description}
          </Text>
        ) : null}
        {preview.imageUrl ? (
          <Image
            source={{ uri: preview.imageUrl }}
            style={{ width: imageWidth, height: imageWidth * 0.52, borderRadius: 10, marginTop: 4 }}
            contentFit="cover"
          />
        ) : null}
      </View>
    </Pressable>
  );
}
