import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

// Composer screens drop their home-indicator bottom padding while the
// keyboard is up — otherwise it shows as a gap above the keyboard.
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
