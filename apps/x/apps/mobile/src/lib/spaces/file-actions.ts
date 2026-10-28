import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Share } from 'react-native';

import type { SpacesClient } from './client';
import { friendlyError } from './errors';

// What you can do with a space file (2026-10-28): send it in the space's chat,
// copy its link, or share the link through the system sheet. The link is the
// contract's canonical file link (https://<org>/s/<space>/a/<id>); in a
// message it reads as the file's name.

export function fileLink(org: string, space: string, assetId: string): string {
  return `https://${org}/s/${space}/a/${encodeURIComponent(assetId)}`;
}

export function showFileActions(opts: { client: SpacesClient; org: string; space: string; assetId: string; name: string; spaceName?: string }) {
  const { client, org, space, assetId, name, spaceName } = opts;
  const link = fileLink(org, space, assetId);
  const send = () => {
    client
      .postMessage(space, { body: `[${name.replace(/[[\]]/g, '')}](${link})`, actingMode: 'direct' })
      .then(() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Sent', spaceName ? `${name} is in #${spaceName}.` : `${name} is in the chat.`);
      })
      .catch((err) => Alert.alert('Couldn’t send the file', friendlyError(err)));
  };
  const copy = () => {
    void Clipboard.setStringAsync(link);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
  };
  const share = () => void Share.share({ url: link, message: process.env.EXPO_OS === 'ios' ? undefined : link, title: name }).catch(() => {});

  const actions: [string, () => void][] = [
    [spaceName ? `Send in #${spaceName}` : 'Send in chat', send],
    ['Copy link', copy],
    ['Share…', share],
  ];
  if (process.env.EXPO_OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: name, options: [...actions.map(([label]) => label), 'Cancel'], cancelButtonIndex: actions.length },
      (i) => actions[i]?.[1](),
    );
    return;
  }
  Alert.alert(name, undefined, [...actions.map(([text, onPress]) => ({ text, onPress })), { text: 'Cancel', style: 'cancel' as const }]);
}
