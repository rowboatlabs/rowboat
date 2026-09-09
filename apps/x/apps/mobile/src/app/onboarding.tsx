import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '@/theme/colors';

// First-launch onboarding: a short swipeable walk through what the app is,
// ending at the sign-in. Shown once (ONBOARDED_KEY); skippable at any point.

export const ONBOARDED_KEY = 'rowboat.onboarded.v1';

const SLIDES = [
  {
    icon: 'sf:sailboat',
    title: 'Welcome to Spaces',
    sub: 'by Rowboat',
    detail: 'Your team, your files, and your agents — together in one place.',
  },
  {
    icon: 'sf:bubble.left.and.bubble.right.fill',
    title: 'Talk in Spaces',
    detail: 'Every space has one stream. A message that gets replies becomes its own thread — react, reply, catch up live.',
  },
  {
    icon: 'sf:folder.fill',
    title: 'Files are the record',
    detail: 'Plans, notes, and decisions live as files next to the conversation — everyone (and every agent) reads the same page.',
  },
  {
    icon: 'sf:sparkles',
    title: 'Agents included',
    detail: 'Mention @rowboat in any message and your agent picks it up — summarize a thread, draft a doc, fold in a decision.',
  },
  {
    icon: 'sf:laptopcomputer.and.iphone',
    title: 'Bring your Mac',
    detail: 'Use the Rowboat Mac app? Connect it any time from the menu to continue your chats and read your Brain from your phone.',
  },
] as const;

export default function OnboardingScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const last = page === SLIDES.length - 1;

  const finish = () => {
    void AsyncStorage.setItem(ONBOARDED_KEY, '1');
    router.replace('/spaces');
  };

  const next = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    if (last) return finish();
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Skip — always available, top right */}
      <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 8 }}>
        <Pressable onPress={finish} hitSlop={10} style={{ padding: 4, opacity: last ? 0 : 1 }}>
          <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={{ width, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44, gap: 18 }}>
            <Image source={slide.icon} style={{ width: 64, height: 64, marginBottom: 8 }} tintColor={colors.label} />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 25, fontWeight: '700', textAlign: 'center', color: colors.label }}>{slide.title}</Text>
              {'sub' in slide ? (
                <Text style={{ fontSize: 14, color: colors.tertiaryLabel }}>{slide.sub}</Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 15, lineHeight: 22, textAlign: 'center', color: colors.secondaryLabel }}>{slide.detail}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots + action */}
      <View style={{ paddingHorizontal: 28, paddingBottom: 24, gap: 22 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7 }}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === page ? 20 : 7, height: 7, borderRadius: 4,
                backgroundColor: i === page ? colors.label : colors.separator,
              }}
            />
          ))}
        </View>
        <Pressable
          onPress={next}
          style={({ pressed }) => ({
            paddingVertical: 14, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center',
            backgroundColor: colors.label, opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.background }}>
            {last ? 'Get started' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
