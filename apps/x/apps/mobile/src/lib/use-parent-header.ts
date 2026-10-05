import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, type ReactNode } from 'react';

// The Spaces tabs share one header — the stack screen that holds the tab bar
// (spaces/_layout.tsx). The focused tab names it and owns its right button.
export function useParentHeader(title: string, headerRight?: () => ReactNode): void {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      navigation.getParent()?.setOptions({ title, headerRight: headerRight ?? (() => null) });
    }, [navigation, title, headerRight]),
  );
}
