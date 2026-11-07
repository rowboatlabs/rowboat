import type { File } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { BlobVideo } from '@/components/blob-video';
import { Image as SymbolImage } from '@/components/sf-image';
import { friendlyError } from '@/lib/spaces/errors';
import { shareFile } from '@/lib/spaces/open-blob';

// A video attached to a message (2026-11-07): plays here, and the share
// button keeps what tapping used to do — Save Video, Save to Files, send on.
export default function SpaceVideoScreen() {
  const { org, space, hash, name } = useLocalSearchParams<{ org: string; space: string; hash: string; name: string }>();
  const [file, setFile] = useState<File | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen
        options={{
          title: name,
          headerStyle: { backgroundColor: '#000' },
          headerTintColor: '#fff',
          headerTitleStyle: { color: '#fff' },
          headerRight: () =>
            file ? (
              <Pressable
                hitSlop={10}
                accessibilityLabel="Share video"
                onPress={() => {
                  shareFile(file, undefined, name).catch((err) => Alert.alert("Couldn't share the video", friendlyError(err, 'Try again.')));
                }}
              >
                <SymbolImage source="sf:square.and.arrow.up" style={{ width: 19, height: 22 }} contentFit="contain" tintColor="#fff" />
              </Pressable>
            ) : null,
        }}
      />
      <BlobVideo org={org} spaceId={space} hash={hash} name={name} onReady={setFile} />
    </View>
  );
}
