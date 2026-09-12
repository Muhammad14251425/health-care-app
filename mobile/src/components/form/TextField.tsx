/**
 * A plain, state-controlled text field.
 *
 * The existing `FormInput` is bound to react-hook-form via `useController`,
 * which is right for the multi-field staff forms. The patient auth/profile
 * screens hold one or two values in local state, so they use this instead of
 * pulling in a form library for a single input. Styling is identical, so the two
 * are indistinguishable on screen.
 */

import { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';

export type TextFieldProps = TextInputProps & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Renders the field greyed and non-editable, with an explanatory hint. */
  locked?: boolean;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, locked, style, ...rest },
  ref,
) {
  return (
    <View>
      <Text variant="label" muted>
        {label}
      </Text>

      <TextInput
        ref={ref}
        editable={!locked && rest.editable !== false}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...rest}
        style={[
          typography.body,
          {
            marginTop: spacing.sm,
            height: 52,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: error ? colors.danger : colors.line,
            backgroundColor: locked ? colors.bg : colors.card,
            color: locked ? colors.muted : colors.ink,
            paddingHorizontal: spacing.md,
          },
          style,
        ]}
      />

      {error ? (
        <Text variant="micro" color={colors.danger} style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" muted style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
