import { useMemo } from 'react';
import { Platform } from 'react-native';
import Markdown from 'react-native-markdown-display';

import { useColors } from '@/theme/colors';

// Chat markdown, tuned to read like the top chat apps: comfortable body
// leading, quiet mono code surfaces, restrained headings, minimal quote bar.
// One component so every markdown surface (chat, notes) renders identically.

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function ChatMarkdown({ children }: { children: string }) {
  const colors = useColors();
  const styles = useMemo(
    () => ({
      body: { color: colors.label, fontSize: 16, lineHeight: 24 },
      paragraph: { marginTop: 0, marginBottom: 10 },
      heading1: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28, marginTop: 18, marginBottom: 8, color: colors.label },
      heading2: { fontSize: 19, fontWeight: '700' as const, lineHeight: 25, marginTop: 16, marginBottom: 6, color: colors.label },
      heading3: { fontSize: 17, fontWeight: '600' as const, lineHeight: 23, marginTop: 14, marginBottom: 4, color: colors.label },
      heading4: { fontSize: 16, fontWeight: '600' as const, marginTop: 12, marginBottom: 4, color: colors.label },
      heading5: { fontSize: 15, fontWeight: '600' as const, marginTop: 10, marginBottom: 2, color: colors.label },
      heading6: { fontSize: 14, fontWeight: '600' as const, marginTop: 10, marginBottom: 2, color: colors.secondaryLabel },
      strong: { fontWeight: '600' as const },
      em: { fontStyle: 'italic' as const },
      link: { color: colors.label, textDecorationLine: 'underline' as const },
      bullet_list: { marginBottom: 10 },
      ordered_list: { marginBottom: 10 },
      list_item: { marginBottom: 4, flexDirection: 'row' as const },
      bullet_list_icon: { color: colors.tertiaryLabel, fontSize: 16, lineHeight: 24, marginLeft: 2, marginRight: 8 },
      ordered_list_icon: { color: colors.tertiaryLabel, fontSize: 15, lineHeight: 24, marginLeft: 2, marginRight: 8, fontVariant: ['tabular-nums'] as const },
      code_inline: {
        fontFamily: MONO, fontSize: 13.5,
        backgroundColor: colors.secondaryBackground, color: colors.label,
        borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
        borderWidth: 0,
      },
      code_block: {
        fontFamily: MONO, fontSize: 13, lineHeight: 19,
        backgroundColor: colors.secondaryBackground, color: colors.label,
        borderRadius: 10, borderCurve: 'continuous' as const, borderWidth: 0,
        padding: 12, marginBottom: 10,
      },
      fence: {
        fontFamily: MONO, fontSize: 13, lineHeight: 19,
        backgroundColor: colors.secondaryBackground, color: colors.label,
        borderRadius: 10, borderCurve: 'continuous' as const, borderWidth: 0,
        padding: 12, marginBottom: 10,
      },
      blockquote: {
        backgroundColor: 'transparent',
        borderLeftWidth: 3, borderLeftColor: colors.separator,
        paddingLeft: 12, paddingVertical: 2, marginLeft: 0, marginBottom: 10,
      },
      hr: { backgroundColor: colors.separator, height: 1, marginVertical: 16 },
      table: { borderWidth: 1, borderColor: colors.separator, borderRadius: 8, marginBottom: 10 },
      thead: {},
      th: { padding: 8, fontWeight: '600' as const },
      td: { padding: 8, borderTopWidth: 1, borderColor: colors.separator },
      tr: { borderBottomWidth: 0, flexDirection: 'row' as const },
    }),
    [colors],
  );
  // react-native-markdown-display's style typing is looser than ours.
  return <Markdown style={styles as never}>{children}</Markdown>;
}
