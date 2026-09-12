/**
 * Step 2 of patient sign-in: enter the 6-digit code.
 *
 * A single hidden TextInput backs six visible boxes. That is deliberate: six
 * separate inputs fight the keyboard, break SMS autofill, and make backspace
 * behave unpredictably. One input keeps autofill (`oneTimeCode`) working and
 * lets the boxes be pure presentation.
 *
 * Every failure -- wrong, expired, already used, too many attempts -- comes back
 * from the server with the same wording, because distinguishing them would tell
 * an attacker which numbers have live codes. This screen shows what it is given
 * and does not try to guess a more specific reason.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { requestOtp, verifyOtp } from '@/api/patientAuth';
import { messageForError } from '@/api/errors';
import { useAuth } from '@/stores/auth';
import { colors, radius, spacing, typography } from '@/theme';

const CODE_LENGTH = 6;

export default function PatientOtpScreen() {
  const params = useLocalSearchParams<{
    phone?: string;
    display?: string;
    resendIn?: string;
    devChannel?: string;
  }>();
  const phone = params.phone ?? '';
  const display = params.display || phone;

  // Set only when the backend is in developer_mode AND the code was not actually
  // dispatched to a device (the console/null providers). Telling the tester
  // "we sent a code to your number" when nothing left the server is a lie the
  // UI should not tell -- and it wastes real time waiting for an SMS.
  const undelivered = params.devChannel || '';

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => Number(params.resendIn ?? 45) || 45);
  const inputRef = useRef<TextInput>(null);
  const toast = useToast();
  const { signInWithPatientSession } = useAuth();

  // Resend countdown.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const countdown = useMemo(() => {
    const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const s = String(secondsLeft % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, [secondsLeft]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || submitting) return;
    setSubmitting(true);
    try {
      const session = await verifyOtp(phone, value);
      await signInWithPatientSession(session);

      // A verified number with no patient record finishes registration first.
      if (session.needs_registration) {
        router.replace('/(patient-auth)/register');
      } else {
        router.replace('/(patient)/(tabs)');
      }
    } catch (error) {
      setCode('');
      toast.error(messageForError(error));
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (secondsLeft > 0) return;
    try {
      const result = await requestOtp(phone);
      setSecondsLeft(result.resend_in || 45);
      setCode('');
      toast.success('We sent a new code.');
      inputRef.current?.focus();
    } catch (error) {
      toast.error(messageForError(error));
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

        <Text style={[typography.heading1, { marginTop: spacing.xl }]}>
          Verify your number
        </Text>
        <Text muted style={{ marginTop: spacing.sm }}>
          {undelivered ? 'Enter the code for' : 'We sent a code to'}{'\n'}
          <Text style={typography.body}>{display}</Text>
        </Text>

        {undelivered ? (
          <View
            style={{
              marginTop: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.paleYellow,
            }}
          >
            <Text variant="caption" color={colors.warning}>
              Development mode — no SMS was sent
            </Text>
            <Text variant="micro" muted style={{ marginTop: spacing.xs }}>
              The OTP provider is “{undelivered}”, so the code was written to the
              backend log instead of being delivered to this number. Read it with:
            </Text>
            <Text
              variant="micro"
              style={{ marginTop: spacing.xs, fontFamily: 'Poppins_500Medium' }}
            >
              bench --site clinic.localhost execute{'\n'}
              clinic_core.api.v1.dev_otp.peek{'\n'}
              --kwargs "{'{'}'phone_number': '{phone}'{'}'}"
            </Text>
          </View>
        ) : null}

        {/* The visible boxes are presentation; the input below holds the value. */}
        <Pressable
          onPress={() => inputRef.current?.focus()}
          accessibilityRole="button"
          accessibilityLabel="Enter verification code"
          style={{
            flexDirection: 'row',
            gap: spacing.sm,
            marginTop: spacing.xl,
          }}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, index) => {
            const char = code[index] ?? '';
            const active = index === code.length;
            return (
              <View
                key={index}
                style={{
                  flex: 1,
                  height: 58,
                  borderRadius: radius.md,
                  backgroundColor: colors.card,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? colors.green : colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[typography.heading2, { fontSize: 22 }]}>{char}</Text>
              </View>
            );
          })}
        </Pressable>

        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(next) => {
            const cleaned = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
            setCode(cleaned);
            // Submit as soon as the code is complete -- one less tap, and it is
            // what people expect from an OTP field.
            if (cleaned.length === CODE_LENGTH) void submit(cleaned);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          autoFocus
          maxLength={CODE_LENGTH}
          accessibilityLabel="Verification code"
          // Off-screen rather than display:none, which would stop it focusing.
          style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
        />

        <Button
          label="Verify"
          onPress={() => submit(code)}
          disabled={code.length !== CODE_LENGTH || submitting}
          loading={submitting}
          fullWidth
          size="lg"
          style={{ marginTop: spacing.xl }}
        />

        <View style={{ marginTop: spacing.lg, alignItems: 'center' }}>
          {secondsLeft > 0 ? (
            <Text variant="caption" muted>
              Resend code in {countdown}
            </Text>
          ) : (
            <Pressable onPress={onResend} accessibilityRole="button" hitSlop={8}>
              <Text variant="caption" color={colors.green}>
                Resend code
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={{ marginTop: spacing.md, alignItems: 'center' }}
        >
          <Text variant="caption" muted>
            Wrong number? Change it
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </Screen>
  );
}
