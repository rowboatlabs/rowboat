import { useColorScheme } from 'react-native';

// Minimal palette, plain hex (Apple HIG values). Semantic PlatformColor
// objects crash Expo Go's prop parser on border colors — hex is boring and
// works; useColors() flips the set with the system theme.
// Light is a warm paper white rather than pure #fff: a hair of warmth in the
// ground, the fills and the hairlines so they read as one family.
export const light = {
  isDark: false,
  label: '#1c1b19',
  secondaryLabel: '#45423c',
  tertiaryLabel: '#8f8b84',
  separator: 'rgba(66,56,40,0.16)',
  background: '#faf9f6',
  secondaryBackground: '#f1efea',
  /** Grouped screens (Spaces, Settings, Account): the ground, and the cards on it. */
  groupedBackground: '#f1efea',
  card: '#faf9f6',
  accent: '#000000',
  onAccent: '#ffffff',
  destructive: '#ff3b30',
};

// Dark is a warm charcoal, not pure black: the same hint of warmth as light,
// soft off-white text (pure white on black glares), and surfaces that get
// LIGHTER as they come forward — ground, then cards, then fills.
export const dark: typeof light = {
  isDark: true,
  label: '#f2efe9',
  secondaryLabel: '#c4c0b8',
  tertiaryLabel: '#86827b',
  separator: 'rgba(255,244,225,0.10)',
  background: '#171614',
  secondaryBackground: '#24221f',
  groupedBackground: '#100f0e',
  card: '#1b1a18',
  accent: '#f2efe9',
  onAccent: '#171614',
  destructive: '#ff5a4f',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}
