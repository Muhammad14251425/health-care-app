/**
 * Step 1 of patient sign-in: enter the mobile number.
 *
 * The field accepts whatever the patient is used to typing -- 0300…, 300…,
 * +92 300… -- because the SERVER normalises it (clinic_core.api.v1.phone). The
 * grouping here is for readability only; nothing depends on it, and the digits
 * are sent as typed.
 *
 * The response deliberately does not say whether the number belongs to an
 * account, so this screen always advances to the code step.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Phone } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { useToast } from '@/components/ui/Toast';
import { requestOtp } from '@/api/patientAuth';
import { messageForError } from '@/api/errors';
import { colors, radius, spacing, typography } from '@/theme';

export default function PatientPhoneScreen() {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const digits = value.replace(/[^\d+]/g, '');
  // Permissive on purpose -- the server is the authority on what is valid. This
  // only stops an obviously empty submit.
  const canSubmit = digits.replace(/\D/g, '').length >= 10 && !submitting;

  const onContinue = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await requestOtp(digits);
      router.push({
        pathname: '/(patient-auth)/otp',
        params: {
          phone: digits,
          display: result.phone ?? digits,
          resendIn: String(result.resend_in ?? 45),
          // Only ever set in development -- see OtpRequestResult.dev.
          devChannel: result.dev?.delivered_to_device
            ? ''
            : (result.dev?.channel ?? ''),
        },
      });
    } catch (error) {
      toast.error(messageForError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={{ width: 40, height: 40, justifyContent: 'center' }}
        >
          <ArrowLeft size={22} color={colors.ink} strokeWidth={1.8} />
        </Pressable>

        <View style={{ marginTop: spacing.lg }}>
          <Logo />
        </View>

        <Text style={[typography.heading1, { marginTop: spacing.xl }]}>Welcome</Text>
        <Text muted style={{ marginTop: spacing.sm }}>
          Enter your mobile number and we'll send you a verification code.
        </Text>

        <View style={{ marginTop: spacing.xl }}>
          <Text variant="label" muted>
            Mobile number
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              backgroundColor: colors.card,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.line,
              paddingHorizontal: spacing.md,
              height: 56,
              marginTop: spacing.sm,
            }}
          >
            <Phone size={18} color={colors.muted} strokeWidth={1.7} />
            <Text style={[typography.body, { color: colors.muted }]}>+92</Text>
            <View style={{ width: 1, height: 22, backgroundColor: colors.line }} />
            <TextInput
              value={value}
              onChangeText={(next) => setValue(next.replace(/[^\d+\s]/g, ''))}
              onSubmitEditing={onContinue}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              autoFocus
              placeholder="300 1234567"
              placeholderTextColor={colors.muted}
              returnKeyType="go"
              accessibilityLabel="Mobile number"
              maxLength={17}
              style={[
                typography.body,
                { flex: 1, color: colors.ink, paddingVertical: 0, height: '100%' },
              ]}
            />
          </View>

          <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
            You can type it as 0300 1234567 or +92 300 1234567.
          </Text>
        </View>

        <Button
          label="Continue"
          onPress={onContinue}
          disabled={!canSubmit}
          loading={submitting}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.xl }}
        />

        <Pressable
          onPress={() => router.replace('/(public)/welcome')}
          accessibilityRole="button"
          style={{ marginTop: spacing.lg, alignItems: 'center' }}
        >
          <Text variant="caption" color={colors.green}>
            Book as a guest instead
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}
