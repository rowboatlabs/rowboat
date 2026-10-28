import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

import { HeaderAvatar } from '@/components/header-avatar';

// The Spaces tabs share one header — the stack screen that holds the tab bar
// (spaces/_layout.tsx). The focused tab names it and owns its right button.
export function useParentHeader(title: string, headerRight?: () => ReactNode): void {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      // No button of its own → your avatar (the way to Account).
      navigation.getParent()?.setOptions({ title, headerRight: headerRight ?? (() => <HeaderAvatar />) });
    }, [navigation, title, headerRight]),
  );
}
