import { Component, memo, useMemo, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-display';
// @ts-expect-error no types shipped
import texmath from 'markdown-it-texmath';
import MathJaxSvg from 'react-native-mathjax-svg';

import { useColors } from '@/theme/colors';

// Math pipeline (the ChatterUI recipe): texmath tokenizes $…$/$$…$$ and
// \(…\)/\[…\] into math_* tokens; MathJax→SVG typesets them natively (no
// WebView, Expo Go safe). The stub engine stops texmath require()-ing katex —
// markdown-display walks tokens itself and never calls md.renderer.
const markdownIt = MarkdownIt({ typographer: true }).use(texmath, {
  delimiters: ['dollars', 'brackets'],
  engine: { renderToString: () => '' },
});

// The renderer has a known crash on pathological TeX — fail soft to raw text.
class MathBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Typesetting is CPU-heavy — memo on the TeX string so streaming re-renders
// don't re-typeset every earlier equation.
const MathSegment = memo(function MathSegment({ tex, fontSize, color, block }: {
  tex: string;
  fontSize: number;
  color: string;
  block?: boolean;
}) {
  const fallback = (
    <Text selectable style={{ fontFamily: MONO, fontSize: 13.5, color }}>
      {tex}
    </Text>
  );
  const svg = (
    <MathBoundary fallback={fallback}>
      <MathJaxSvg fontSize={fontSize} color={color}>
        {tex}
      </MathJaxSvg>
    </MathBoundary>
  );
  if (!block) return svg;
  // Wide equations scroll sideways instead of clipping at the screen edge.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // width 100% claims a full row inside a wrapping paragraph, so promoted
      // inline math never shares a line (and never overlaps) with prose.
      style={{ marginVertical: 10, width: '100%' }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 2 }}
    >
      {svg}
    </ScrollView>
  );
});

// Tall constructs (fractions, big operators, matrices) can't sit inside a
// text line without colliding with neighbors — promote them to display math,
// like the big chat apps do.
const TALL_TEX = /\\frac|\\dfrac|\\sum|\\prod|\\int|\\begin\{|\\over(?![a-z])|\\stackrel|\\substack|\\binom/;


// Chat markdown, tuned to read like the top chat apps: comfortable body
// leading, quiet mono code surfaces, restrained headings, minimal quote bar.
// One component so every markdown surface (chat, notes) renders identically.

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export function ChatMarkdown({ children }: { children: string }) {
  const colors = useColors();
  const styles = useMemo(
    () => ({
      body: { color: colors.label, fontSize: 16, lineHeight: 24 },
      // row+wrap so inline math SVGs sit inside the text line (plain
      // paragraphs have a single Text child and are unaffected).
      // flex-end (not center) — centering tall children makes wrapped rows
      // overlay their neighbors.
      paragraph: { marginTop: 0, marginBottom: 10, flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'flex-end' as const },
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
  const rules = useMemo(() => {
    const inline = (node: { key: string; content: string }) =>
      TALL_TEX.test(node.content) ? (
        <MathSegment key={node.key} tex={node.content} fontSize={15} color={colors.label} block />
      ) : (
        <MathSegment key={node.key} tex={node.content} fontSize={15} color={colors.label} />
      );
    const block = (node: { key: string; content: string }) => (
      <MathSegment key={node.key} tex={node.content} fontSize={16} color={colors.label} block />
    );
    // All four texmath token types — an unregistered type renders as NOTHING
    // (markdown-display's `unknown` rule returns null), which silently eats
    // chat content.
    return {
      math_inline: inline,
      math_inline_double: block,
      math_block: block,
      math_block_eqno: block,
    };
  }, [colors]);

  // react-native-markdown-display's style/rule typings are looser than ours.
  return (
    <Markdown markdownit={markdownIt} rules={rules as never} style={styles as never}>
      {children}
    </Markdown>
  );
}
