import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

// A bottom sheet whose backdrop FADES in place while the sheet slides up.
// (RN's Modal animationType="slide" slides the dimmed backdrop up with the
// sheet — a dark slab riding up the screen.) Closing plays the reverse before
// the modal unmounts.
export function BottomSheet({ visible, onClose, style, maxHeight = 0.8, children }: {
  visible: boolean;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  /** Tallest the sheet may grow, as a fraction of the screen (content scrolls past it). */
  maxHeight?: number;
  children: ReactNode;
}) {
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  // Backdrop tap / back gesture: play the exit, then tell the owner.
  const dismiss = () => {
    Animated.timing(progress, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  };

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={dismiss}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', opacity: progress }} />
      <Pressable style={{ flex: 1, justifyContent: 'flex-end' }} onPress={dismiss}>
        <Animated.View style={{ transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] }) }] }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={[{ maxHeight: height * maxHeight }, style]}>
            {children}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
