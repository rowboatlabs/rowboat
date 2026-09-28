import { useColorScheme } from 'react-native';

// Minimal palette, plain hex (Apple HIG values). Semantic PlatformColor
// objects crash Expo Go's prop parser on border colors — hex is boring and
// works; useColors() flips the set with the system theme.
// Light is a warm paper white rather than pure #fff: a hair of warmth in the
// ground, the fills and the hairlines so they read as one family.
export const light = {
  label: '#1c1b19',
  secondaryLabel: '#45423c',
  tertiaryLabel: '#8f8b84',
  separator: 'rgba(66,56,40,0.16)',
  background: '#faf9f6',
  secondaryBackground: '#f1efea',
  accent: '#000000',
  onAccent: '#ffffff',
  destructive: '#ff3b30',
};

export const dark: typeof light = {
  label: '#ffffff',
  secondaryLabel: '#ebebf5',
  tertiaryLabel: '#8e8e93',
  separator: 'rgba(84,84,88,0.6)',
  background: '#000000',
  secondaryBackground: '#1c1c1e',
  accent: '#ffffff',
  onAccent: '#000000',
  destructive: '#ff453a',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
