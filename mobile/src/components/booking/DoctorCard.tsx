/**
 * Doctor card for the booking flow: avatar, name, specialty and the next
 * available time.
 *
 * The "next available" line is fetched per doctor, so it is optional -- the card
 * renders immediately and fills that line in when it arrives, rather than
 * holding the whole list back.
 */

import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { formatCurrency } from '@/utils/currency';
import { colors, spacing } from '@/theme';
import type { PublicPractitioner } from '@/types/domain';

export type DoctorCardProps = {
  practitioner: PublicPractitioner;
  onPress: () => void;
  /** e.g. "10:30 AM" -- omitted while loading, null when nothing is free. */
  nextAvailable?: string | null;
  loadingAvailability?: boolean;
};

export function DoctorCard({
  practitioner,
  onPress,
  nextAvailable,
  loadingAvailability = false,
}: DoctorCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Choose ${practitioner.practitioner_name}`}
      style={{ marginBottom: spacing.sm }}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={practitioner.practitioner_name} size={46} />

          <View style={{ flex: 1 }}>
            <Text variant="cardTitle" numberOfLines={1}>
              {practitioner.practitioner_name}
            </Text>
            <Text variant="caption" muted numberOfLines={1} style={{ marginTop: 2 }}>
              {practitioner.designation || practitioner.department || 'Practitioner'}
            </Text>
            {practitioner.consultation_fee ? (
              <Text variant="micro" muted style={{ marginTop: 4 }}>
                {formatCurrency(practitioner.consultation_fee)} consultation
              </Text>
            ) : null}
          </View>

          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text variant="micro" muted>
              Next available
            </Text>
            <Text
              variant="cardTitle"
              color={nextAvailable ? colors.green : colors.muted}
              style={{ fontSize: 12 }}
            >
              {loadingAvailability ? '—' : (nextAvailable ?? 'Call us')}
            </Text>
          </View>

          <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} />
        </View>
      </Card>
    </Pressable>
  );
}
