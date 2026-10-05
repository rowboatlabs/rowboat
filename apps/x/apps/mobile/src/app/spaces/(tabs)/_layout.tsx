import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useSpacesAccount } from '@/lib/spaces/account';

// The Spaces section's bottom bar (2026-10-05): the system tab bar — on iOS 26
// the liquid-glass pill with a separate search button, the same control Slack
// uses. Channels, threads and settings are pushed on the stack ABOVE this
// (spaces/_layout.tsx), so they cover the bar.
export default function SpacesTabsLayout() {
  const account = useSpacesAccount();
  return (
    <NativeTabs hidden={account.status !== 'signedIn'} minimizeBehavior="onScrollDown">
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
