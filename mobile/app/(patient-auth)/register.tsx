/**
 * First login for a verified number the clinic has no record of (Case B).
 *
 * Reached only with a session that has already proven the phone number, and only
 * while it has no Patient record -- `patient_auth.register` refuses otherwise.
 *
 * Kept to the minimum Marley actually requires: a name, and a gender because
 * `Patient.sex` is mandatory. Date of birth and email are optional; a person
 * signing up to see their appointments should not face a form.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/form/TextField';
import { DateOfBirthField } from '@/components/form/DateOfBirthField';
import { useToast } from '@/components/ui/Toast';
import { register } from '@/api/patientAuth';
import { messageForError } from '@/api/errors';
import { useAuth } from '@/stores/auth';
import { colors, radius, spacing, typography } from '@/theme';

// Marley ships these on the Gender doctype. "Prefer not to say" is offered
// because requiring disclosure to book a doctor is not defensible -- the public
// booking flow already took this position.
const GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'];

export default function PatientRegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('Prefer not to say');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const { refresh, signOut } = useAuth();

  const canSubmit = fullName.trim().length >= 2 && !submitting;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await register({
        full_name: fullName.trim(),
        gender,
        dob: dob.trim() || null,
        email: email.trim() || null,
      });
      // Pick up the newly linked patient id before entering the app.
      await refresh();
      router.replace('/(patient)/(tabs)');
    } catch (error) {
      toast.error(messageForError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={[typography.heading1, { marginTop: spacing.lg }]}>
            Complete your profile
          </Text>
          <Text muted style={{ marginTop: spacing.sm }}>
            Your number is verified. Tell us who you are so the clinic can find
            your records.
          </Text>

          <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
            <TextField
              label="Full name"
              value={fullName}
              onChangeText={setFullName}
              placeholder="e.g. Ali Khan"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
            />

            <View>
              <Text variant="label" muted>
                Gender
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: spacing.sm,
                  marginTop: spacing.sm,
                }}
              >
                {GENDERS.map((option) => {
                  const selected = option === gender;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setGender(option)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={{
                        paddingHorizontal: spacing.md,
                        height: 40,
                        justifyContent: 'center',
                        borderRadius: radius.pill,
                        backgroundColor: selected ? colors.green : colors.card,
                        borderWidth: 1,
                        borderColor: selected ? colors.green : colors.line,
                      }}
                    >
                      <Text
                        variant="caption"
                        color={selected ? colors.white : colors.ink}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <DateOfBirthField
              label="Date of birth (optional)"
              value={dob}
              onChange={setDob}
              optional
              hint="Helps the clinic tell patients with similar names apart."
            />

            <TextField
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
            />
          </View>

          <Button
            label="Create my account"
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={submitting}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xl }}
          />

          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={{ marginTop: spacing.lg, alignItems: 'center' }}
          >
            <Text variant="caption" muted>
              Cancel and sign out
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
