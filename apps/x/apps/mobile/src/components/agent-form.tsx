import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { DESCRIPTION_MAX, INSTRUCTIONS_MAX } from '@/lib/spaces/agents';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// The fields an agent's owner fills in, shared by New agent and the agent's
// page (2026-11-13, desktop agent-personality.tsx): a labelled card per field,
// in the grouped screens' look. The desktop's "Describe → Write" draft runs a
// model on the desktop only, so the phone has the plain fields.

export function Field({ label, note, multiline, ...input }: { label: string; note?: string } & TextInputProps) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{label}</Text>
      <View style={{ paddingHorizontal: 14, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.card }}>
        <TextInput
          placeholderTextColor={colors.tertiaryLabel}
          multiline={multiline}
          {...input}
          style={{
            paddingVertical: 13, ...type.body, color: colors.label,
            ...(multiline ? { minHeight: 132, textAlignVertical: 'top' as const } : {}),
          }}
        />
      </View>
      {note ? <Text style={{ ...type.caption, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{note}</Text> : null}
    </View>
  );
}

/** Description and personality: both optional, both readable by everyone on the server. */
export function PersonalityFields({ title, onTitle, instructions, onInstructions, editable = true }: {
  title: string;
  onTitle: (title: string) => void;
  instructions: string;
  onInstructions: (instructions: string) => void;
  editable?: boolean;
}) {
  return (
    <>
      <Field
        label="Description (optional)"
        value={title}
        onChangeText={onTitle}
        placeholder="e.g. Reviews pull requests and runs the tests"
        maxLength={DESCRIPTION_MAX}
        editable={editable}
        note="One line, shown on its profile."
      />
      <Field
        label="Personality (optional)"
        value={instructions}
        onChangeText={onInstructions}
        placeholder={'How it should behave. It reads this before every request.\nYou are Scout, the team’s reviewer. Be brief…'}
        maxLength={INSTRUCTIONS_MAX}
        multiline
        editable={editable}
        note={`Everyone on the server can read it.${instructions.length > INSTRUCTIONS_MAX - 500 ? ` ${instructions.length} / ${INSTRUCTIONS_MAX}` : ''}`}
      />
    </>
  );
}
