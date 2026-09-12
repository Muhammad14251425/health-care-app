/**
 * Step 5 -- patient details.
 *
 * Only what a booking genuinely needs. Gender is deliberately not asked: the
 * backend defaults it to "Prefer not to say", so a public form has no reason to
 * demand it before someone can see a doctor.
 */

import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { FormInput } from '@/components/form/FormInput';
import { BookingProgress } from '@/components/booking/BookingSteps';
import { useBookingStore } from '@/stores/booking';
import { bookingDetailsSchema, type BookingDetailsForm } from '@/validation/schemas';
import { spacing } from '@/theme';

export default function BookingDetails() {
  const router = useRouter();
  const practitioner = useBookingStore((state) => state.practitioner);
  const time = useBookingStore((state) => state.time);
  const details = useBookingStore((state) => state.details);
  const setDetails = useBookingStore((state) => state.setDetails);

  const { control, handleSubmit } = useForm<BookingDetailsForm>({
    resolver: zodResolver(bookingDetailsSchema),
    defaultValues: {
      first_name: details?.first_name ?? '',
      last_name: details?.last_name ?? '',
      phone: details?.phone ?? '',
      email: details?.email ?? '',
      reason: details?.reason ?? '',
    },
  });

  const ready = Boolean(practitioner && time);

  const onSubmit = handleSubmit((values) => {
    setDetails({
      first_name: values.first_name.trim(),
      last_name: (values.last_name ?? '').trim(),
      phone: values.phone.trim(),
      email: (values.email ?? '').trim(),
      reason: (values.reason ?? '').trim(),
    });
    router.push('/(public)/book/confirm');
  });

  if (!ready) return <Redirect href="/(public)/book" />;

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        >
          <BackHeader title="Your details" subtitle="So the clinic can confirm your visit" />
          <BookingProgress step="details" />

          <FormInput
            control={control}
            name="first_name"
            label="First name"
            placeholder="Ali"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="last_name"
            label="Last name (optional)"
            placeholder="Khan"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="phone"
            label="Phone"
            placeholder="0300 1234567"
            type="phone"
            hint="We will send your confirmation here."
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="email"
            label="Email (optional)"
            placeholder="you@example.com"
            type="email"
            returnKeyType="next"
          />
          <FormInput
            control={control}
            name="reason"
            label="Reason for visit (optional)"
            placeholder="Briefly, what would you like to discuss?"
            type="multiline"
          />

          <View style={{ marginTop: spacing.md }}>
            <Button label="Review booking" onPress={onSubmit} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
