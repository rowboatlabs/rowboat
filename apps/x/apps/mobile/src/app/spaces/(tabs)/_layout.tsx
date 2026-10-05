import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useSpacesAccount } from '@/lib/spaces/account';
import { useColors } from '@/theme/colors';

// The Spaces section's bottom bar (2026-10-05): the system tab bar — on iOS 26
// the liquid-glass pill with a separate search button, the same control Slack
// uses. Channels, threads and settings are pushed on the stack ABOVE this
// (spaces/_layout.tsx), so they cover the bar.
export default function SpacesTabsLayout() {
  const account = useSpacesAccount();
  const colors = useColors();
  return (
    <NativeTabs
      hidden={account.status !== 'signedIn'}
      // Always full size: the bar stays put while you scroll.
      minimizeBehavior="never"
      // A touch smaller than the system's default label.
      labelStyle={{ fontSize: 10, fontWeight: '500' }}
      // Monochrome, like the rest of the app: the glass capsule and the filled
      // icon say which tab you're on, not a blue tint.
      tintColor={colors.label}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="dms">
        <NativeTabs.Trigger.Label>DMs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ellipsis" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jump" role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
