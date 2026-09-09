import { useColorScheme } from 'react-native';

// Minimal palette, plain hex (Apple HIG values). Semantic PlatformColor
// objects crash Expo Go's prop parser on border colors — hex is boring and
// works; useColors() flips the set with the system theme.
const light = {
  label: '#000000',
  secondaryLabel: '#3c3c43',
  tertiaryLabel: '#8e8e93',
  separator: 'rgba(60,60,67,0.29)',
  background: '#ffffff',
  secondaryBackground: '#f2f2f7',
  accent: '#000000',
  onAccent: '#ffffff',
  destructive: '#ff3b30',
};

const dark: typeof light = {
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
