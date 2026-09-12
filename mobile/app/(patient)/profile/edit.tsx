/**
 * Edit the contact details a patient is allowed to change.
 *
 * Two fields: email and a secondary phone. The backend's allowlist is exactly
 * this wide, so anything else sent here would be dropped -- the form does not
 * offer it rather than letting someone type into a field that silently does
 * nothing.
 *
 * The LOGIN number is not editable here; it is the credential, and moving it
 * requires proving control of the new number (see ./phone).
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/form/TextField';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { messageForError } from '@/api/errors';
import { colors, spacing } from '@/theme';

export default function PatientEditProfileScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: queryKeys.patientMe, queryFn: patientApi.me });

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Seed the form once the profile arrives.
  useEffect(() => {
    if (query.data) {
      setEmail(query.data.email ?? '');
      setPhone(query.data.phone ?? '');
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: () =>
      patientApi.updateMe({
        email: email.trim() || null,
        phone: phone.trim() || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.patientMe });
      toast.success('Details updated.');
      router.back();
    },
    onError: (error) => toast.error(messageForError(error)),
  });

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <BackHeader title="Edit profile" subtitle="Your contact details" />

        {query.isError ? (
          <View style={{ marginTop: spacing.lg }}>
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </View>
        ) : query.isLoading ? (
          <SkeletonList count={3} />
        ) : (
          <>
            <View style={{ marginTop: spacing.lg, gap: spacing.lg }}>
              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                hint="Used for clinic correspondence, not for signing in."
              />

              <TextField
                label="Other phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="e.g. a landline"
                keyboardType="phone-pad"
                hint="An additional number the clinic can reach you on."
              />
            </View>

            {/* Explain the locked fields rather than hiding them silently. */}
            <Card style={{ marginTop: spacing.xl }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Lock size={16} color={colors.muted} strokeWidth={1.8} />
                <View style={{ flex: 1 }}>
                  <Text variant="caption">Some details cannot be changed here</Text>
                  <Text variant="micro" muted style={{ marginTop: 4 }}>
                    Your name, date of birth, gender and blood group are part of
                    your medical record — ask the clinic to correct them.
                  </Text>
                  <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
                    Your mobile number is how you sign in, so changing it needs a
                    verification code.
                  </Text>
                </View>
              </View>
              <Button
                label="Change mobile number"
                variant="ghost"
                size="sm"
                onPress={() => router.push('/(patient)/profile/phone')}
                style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
              />
            </Card>

            <Button
              label="Save changes"
              onPress={() => save.mutate()}
              loading={save.isPending}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.xl }}
            />
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
