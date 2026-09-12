/**
 * Step 7 -- success. Large, calm, and it surfaces the reference number the
 * caller will be asked to quote.
 */

import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { SummaryRow } from '@/components/ui/SummaryRow';
import { useBookingStore } from '@/stores/booking';
import { formatDateLong, formatTime } from '@/utils/date';
import { colors, radius, spacing } from '@/theme';

export default function BookingSuccess() {
  const router = useRouter();
  const result = useBookingStore((state) => state.result);
  const reset = useBookingStore((state) => state.reset);

  if (!result) return <Redirect href="/(public)/book" />;

  const finish = () => {
    reset();
    router.replace('/(public)/welcome');
  };

  return (
    <Screen>
      <View style={{ alignItems: 'center', paddingTop: spacing.xxxl, paddingBottom: spacing.xl }}>
        <View
          style={{
            width: 74,
            height: 74,
            borderRadius: radius.pill,
            backgroundColor: colors.mint,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.xl,
          }}
        >
          <Check size={34} color={colors.green} strokeWidth={2.4} />
        </View>

        <Text variant="heading1" align="center">
          Appointment booked
        </Text>
        <Text variant="body" muted align="center" style={{ marginTop: spacing.sm, maxWidth: 290 }}>
          We have sent the details to your phone. Please arrive ten minutes early.
        </Text>
      </View>

      <Card flush>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <SummaryRow label="Reference" value={result.reference} strong />
          <SummaryRow label="Doctor" value={result.practitioner_name} />
          <SummaryRow label="Date" value={formatDateLong(result.date)} />
          <SummaryRow label="Time" value={formatTime(result.time)} strong />
          <SummaryRow label="Patient" value={result.patient_name} />
          <SummaryRow label="Type" value={result.appointment_type} last />
        </View>
      </Card>

      <View style={{ marginTop: spacing.xxl }}>
        <Button label="Done" onPress={finish} />
      </View>
    </Screen>
  );
}
