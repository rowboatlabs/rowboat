import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';
import Markdown from 'react-native-markdown-display';

import * as analytics from '@/lib/analytics';
import { useConnection } from '@/lib/connection';

// Read-only note view. Relative image refs are rewritten to the server's
// authenticated /workspace route; the auth header rides along per-image.
// YAML frontmatter is stripped rather than rendered.

function stripFrontmatter(markdown: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

function rewriteImageRefs(markdown: string, noteDir: string, baseUrl: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
    (_m, alt: string, ref: string) => {
      const rel = ref.startsWith('/') ? ref.slice(1) : noteDir ? `${noteDir}/${ref}` : ref;
      return `![${alt}](${baseUrl}/workspace/${rel.split('/').map(encodeURIComponent).join('/')})`;
    },
  );
}

export default function NoteViewScreen() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const { rpc, events, pairing } = useConnection();
  const scheme = useColorScheme();
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!rpc || !path) return;
    try {
      const result = await rpc.call('workspace:readFile', { path });
      const noteDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      setBody(rewriteImageRefs(stripFrontmatter(result.data), noteDir, rpc.baseUrl));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rpc, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    analytics.mobileNoteOpened();
  }, []);

  useEffect(() => {
    if (!events) return;
    // Live notes update themselves on the Mac; refetch when this file changes.
    const off = events.on('workspace:didChange', (payload) => {
      const e = payload as { type: string; path: string };
      if (e.path === path) void refresh();
    });
    return off;
  }, [events, path, refresh]);

  const title = path?.split('/').pop()?.replace(/\.md$/, '') ?? 'Note';
  const textColor = scheme === 'dark' ? '#fff' : '#000';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title }} />
      {error && <Text style={styles.error}>{error}</Text>}
      {body !== null && (
        <Markdown
          style={{ body: { color: textColor, fontSize: 15, lineHeight: 22 } }}
          rules={{
            // Workspace images sit behind the server's bearer auth, so the
            // default <img> rendering won't do — attach the header per image.
            image: (node) => (
              <Image
                key={node.key}
                source={{
                  uri: String(node.attributes.src ?? ''),
                  headers: pairing ? { Authorization: `Bearer ${pairing.token}` } : undefined,
                }}
                style={styles.image}
                resizeMode="contain"
              />
            ),
          }}
        >
          {body}
        </Markdown>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  error: { color: '#c0392b', marginBottom: 8 },
  image: { width: '100%', height: 220, marginVertical: 8 },
});
