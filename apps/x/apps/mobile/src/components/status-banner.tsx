import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { isNetworkError, friendlyError } from '@/lib/spaces/errors';
import { useColors } from '@/theme/colors';

// One quiet banner for a screen's problem. Offline is grey with a wifi-slash
// (it's a state, not a failure); real errors are tinted red. Optional retry.
export function StatusBanner({ error, offlineText, onRetry }: { error: unknown; offlineText?: string; onRetry?: () => void }) {
  const colors = useColors();
  if (!error) return null;
  const offline = isNetworkError(error);
  const text = friendlyError(error, offlineText);
  const tint = offline ? colors.secondaryLabel : colors.destructive;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginVertical: 6,
        paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderCurve: 'continuous',
        backgroundColor: colors.secondaryBackground,
      }}
    >
      <Image source={offline ? 'sf:wifi.slash' : 'sf:exclamationmark.triangle'} style={{ width: 16, height: 16 }} tintColor={tint} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: offline ? colors.secondaryLabel : colors.destructive }}>{text}</Text>
      {onRetry ? (
        <Pressable hitSlop={8} onPress={onRetry}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.label }}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
