import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, View, type ImageStyle, type StyleProp } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { useColors } from '@/theme/colors';

// Profile images (Harbor CONTRACT.md, 2026-10-02): avatars and org logos are
// served by the org at …/v1/images/<sha256>, to members only — so every image
// needs the bearer. The last token is shared so a remounted row paints from
// expo-image's cache in the same frame; the hash is the cache key (a changed
// picture is a changed URL).
let lastToken: string | null = null;

export function AuthedImage({ url, style }: { url: string; style: StyleProp<ImageStyle> }) {
  const account = useSpacesAccount();
  const [token, setToken] = useState<string | null>(lastToken);
  useEffect(() => {
    let cancelled = false;
    account
      .getAccessToken()
      .then((t) => {
        lastToken = t;
        if (!cancelled) setToken(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account, url]);
  if (!token) return null;
  return (
    <Image
      source={{ uri: url, headers: { authorization: `Bearer ${token}` }, cacheKey: url.split('/').pop() ?? url }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={url}
    />
  );
}

const HUES = [211, 262, 174, 32, 340, 90];
export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length]!;
}

/** A person: their photo when they have one, else their initial on a soft tint of their own hue. */
export function Avatar({ id, name, size, url }: { id: string; name: string; size: number; url?: string }) {
  const colors = useColors();
  const hue = hueOf(id);
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.isDark ? `hsl(${hue}, 32%, 26%)` : `hsl(${hue}, 62%, 90%)`,
      }}
    >
      <Text style={{ fontSize: size * 0.43, fontWeight: '600', color: colors.isDark ? `hsl(${hue}, 70%, 82%)` : `hsl(${hue}, 48%, 34%)` }}>
        {(name[0] ?? '?').toUpperCase()}
      </Text>
      {url ? <AuthedImage url={url} style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }} /> : null}
    </View>
  );
}
