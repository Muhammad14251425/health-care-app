/**
 * Form field bound to react-hook-form.
 *
 * Handles the things that are easy to get wrong on mobile and very visible when
 * you do: the right keyboard per field type, inline validation messages, and a
 * focus ring that does not shift layout.
 */

import { useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from 'react-hook-form';
import { colors, radius, spacing, typography } from '@/theme';
import { Text } from '@/components/ui/Text';

export type FormInputProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  /** Chooses the keyboard, autocomplete and capitalisation together. */
  type?: 'text' | 'email' | 'phone' | 'password' | 'number' | 'multiline';
  autoFocus?: boolean;
  editable?: boolean;
  hint?: string;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
};

function keyboardFor(type: string): KeyboardTypeOptions {
  switch (type) {
    case 'email':
      return 'email-address';
    case 'phone':
      return 'phone-pad';
    case 'number':
      return 'decimal-pad';
    default:
      return 'default';
  }
}

export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  placeholder,
  type = 'text',
  autoFocus = false,
  editable = true,
  hint,
  returnKeyType,
  onSubmitEditing,
}: FormInputProps<T>) {
  const { field, fieldState } = useController({ control, name });
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);

  const isPassword = type === 'password';
  const multiline = type === 'multiline';
  const error = fieldState.error?.message;

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" muted style={{ marginBottom: spacing.sm }}>
        {label}
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          backgroundColor: colors.card,
          borderRadius: radius.card,
          paddingHorizontal: spacing.lg,
          paddingVertical: multiline ? spacing.md : 0,
          minHeight: multiline ? 108 : 52,
          // Border width is constant so focus never nudges the layout.
          borderWidth: 1.5,
          borderColor: error ? colors.danger : focused ? colors.green : colors.line,
        }}
      >
        <TextInput
          value={field.value == null ? '' : String(field.value)}
          onChangeText={field.onChange}
          onBlur={() => {
            field.onBlur();
            setFocused(false);
          }}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          editable={editable}
          autoFocus={autoFocus}
          keyboardType={keyboardFor(type)}
          autoCapitalize={type === 'email' || isPassword ? 'none' : 'sentences'}
          autoCorrect={type === 'text' || multiline}
          autoComplete={
            type === 'email' ? 'email' : isPassword ? 'current-password' : type === 'phone' ? 'tel' : 'off'
          }
          textContentType={
            type === 'email' ? 'emailAddress' : isPassword ? 'password' : 'none'
          }
          secureTextEntry={isPassword && !reveal}
          multiline={multiline}
          numberOfLines={multiline ? 4 : 1}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel={label}
          accessibilityHint={hint}
          style={[
            typography.body,
            {
              flex: 1,
              color: editable ? colors.ink : colors.muted,
              paddingVertical: multiline ? 0 : spacing.md,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setReveal((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
            hitSlop={10}
          >
            {reveal ? (
              <EyeOff size={18} color={colors.muted} strokeWidth={1.8} />
            ) : (
              <Eye size={18} color={colors.muted} strokeWidth={1.8} />
            )}
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text variant="micro" color={colors.danger} style={{ marginTop: 6 }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="micro" muted style={{ marginTop: 6 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
