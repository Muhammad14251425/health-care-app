/**
 * Staff sign-in.
 *
 * The failure message stays generic on purpose: the backend deliberately does
 * not distinguish "no such user" from "wrong password" so accounts cannot be
 * enumerated, and the UI must not undo that.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarPlus } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { FormInput } from '@/components/form/FormInput';
import { useAuth } from '@/stores/auth';
import { ApiError } from '@/api/errors';
import { loginSchema, type LoginForm } from '@/validation/schemas';
import { colors, spacing } from '@/theme';

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const { control, handleSubmit, formState } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { usr: '', pwd: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signIn(values.usr.trim(), values.pwd);
      router.replace('/(app)/(tabs)');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'We could not sign you in. Please try again.',
      );
    }
  });

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        >
          <View style={{ paddingVertical: spacing.xxxl }}>
            <Logo />
            <Text variant="heading1" style={{ marginTop: spacing.md }}>
              Welcome back
            </Text>
            <Text variant="body" muted style={{ marginTop: 6, marginBottom: spacing.xxl }}>
              Sign in to manage your clinic
            </Text>

            <FormInput
              control={control}
              name="usr"
              label="Email"
              placeholder="you@clinic.com"
              type="email"
              returnKeyType="next"
            />
            <FormInput
              control={control}
              name="pwd"
              label="Password"
              placeholder="••••••••"
              type="password"
              returnKeyType="go"
              onSubmitEditing={onSubmit}
            />

            {formError ? (
              <View
                style={{
                  backgroundColor: colors.dangerSoft,
                  borderRadius: 12,
                  padding: spacing.md,
                  marginBottom: spacing.lg,
                }}
              >
                <Text variant="bodySmall" color={colors.danger}>
                  {formError}
                </Text>
              </View>
            ) : null}

            <Button
              label="Sign in"
              onPress={onSubmit}
              loading={formState.isSubmitting}
              disabled={formState.isSubmitting}
            />

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                marginVertical: spacing.xl,
              }}
            >
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
              <Text variant="micro" muted>
                or
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
            </View>

            <Button
              label="Book an appointment"
              variant="secondary"
              onPress={() => router.push('/(public)/book')}
              icon={<CalendarPlus size={16} color="#31523F" strokeWidth={2} />}
            />

            <Text variant="micro" muted align="center" style={{ marginTop: spacing.xl }}>
              Need help? Contact your clinic administrator.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
