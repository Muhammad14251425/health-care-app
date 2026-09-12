/**
 * Change the mobile number this account signs in with.
 *
 * Two steps, because the number IS the credential:
 *
 *   1. enter the new number  -> a code is sent TO THAT NUMBER
 *   2. enter the code        -> the mapping moves
 *
 * Sending the code to the new number is the whole point: it proves the person
 * asking actually controls it. A number already attached to another account is
 * refused server-side with neutral wording, so this cannot be used to discover
 * who else banks with the clinic, nor to take a number over.
 */

import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/form/TextField';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { useToast } from '@/components/ui/Toast';
import { confirmPhoneChange, requestPhoneChange } from '@/api/patientAuth';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { colors, radius, spacing, typography } from '@/theme';

const CODE_LENGTH = 6;

export default function PatientChangePhoneScreen() {
  const [step, setStep] = useState<'enter' | 'verify'>('enter');
  const [newPhone, setNewPhone] = useState('');
  const [display, setDisplay] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const toast = useToast();
  const queryClient = useQueryClient();

  const profile = useQuery({ queryKey: queryKeys.patientMe, queryFn: patientApi.me });

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

  const sendCode = async () => {
    const digits = newPhone.replace(/[^\d+]/g, '');
    if (digits.replace(/\D/g, '').length < 10) return;
    setBusy(true);
    try {
      const result = await requestPhoneChange(digits);
      setDisplay(result.phone ?? digits);
      setSecondsLeft(result.resend_in ?? 45);
      setStep('verify');
      setCode('');
    } catch (error) {
      toast.error(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    try {
      const digits = newPhone.replace(/[^\d+]/g, '');
      await confirmPhoneChange(digits, value);
      await queryClient.invalidateQueries({ queryKey: queryKeys.patientMe });
      toast.success('Your mobile number has been updated.');
      router.back();
    } catch (error) {
      setCode('');
      toast.error(messageForError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <BackHeader
          title="Change mobile number"
          subtitle={step === 'enter' ? 'This is how you sign in' : 'Enter the code we sent'}
        />

        <Card style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <ShieldCheck size={16} color={colors.green} strokeWidth={1.8} />
            <View style={{ flex: 1 }}>
              <Text variant="caption">Current number</Text>
              <Text variant="body" style={{ marginTop: 2 }}>
                {profile.data?.login_phone ?? profile.data?.mobile_display ?? '—'}
              </Text>
            </View>
          </View>
        </Card>

        {step === 'enter' ? (
          <>
            <View style={{ marginTop: spacing.xl }}>
              <TextField
                label="New mobile number"
                value={newPhone}
                onChangeText={(next) => setNewPhone(next.replace(/[^\d+\s]/g, ''))}
                placeholder="0300 1234567"
                keyboardType="phone-pad"
                autoFocus
                maxLength={17}
                hint="We'll send a verification code to this number."
              />
            </View>

            <Button
              label="Send code"
              onPress={sendCode}
              disabled={newPhone.replace(/\D/g, '').length < 10 || busy}
              loading={busy}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.xl }}
            />
          </>
        ) : (
          <>
            <Text muted style={{ marginTop: spacing.xl }}>
              We sent a code to{'\n'}
              <Text style={typography.body}>{display}</Text>
            </Text>

            <Pressable
              onPress={() => {}}
              accessibilityRole="none"
              style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}
            >
              {Array.from({ length: CODE_LENGTH }).map((_, index) => (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: 56,
                    borderRadius: radius.md,
                    backgroundColor: colors.card,
                    borderWidth: index === code.length ? 2 : 1,
                    borderColor: index === code.length ? colors.green : colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={[typography.heading2, { fontSize: 21 }]}>
                    {code[index] ?? ''}
                  </Text>
                </View>
              ))}
            </Pressable>

            <TextInput
              value={code}
              onChangeText={(next) => {
                const cleaned = next.replace(/\D/g, '').slice(0, CODE_LENGTH);
                setCode(cleaned);
                if (cleaned.length === CODE_LENGTH) void confirm(cleaned);
              }}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoFocus
              maxLength={CODE_LENGTH}
              accessibilityLabel="Verification code"
              style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
            />

            <Button
              label="Confirm change"
              onPress={() => confirm(code)}
              disabled={code.length !== CODE_LENGTH || busy}
              loading={busy}
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
                <Pressable onPress={sendCode} accessibilityRole="button" hitSlop={8}>
                  <Text variant="caption" color={colors.green}>
                    Resend code
                  </Text>
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={() => {
                setStep('enter');
                setCode('');
              }}
              accessibilityRole="button"
              style={{ marginTop: spacing.md, alignItems: 'center' }}
            >
              <Text variant="caption" muted>
                Use a different number
              </Text>
            </Pressable>
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
