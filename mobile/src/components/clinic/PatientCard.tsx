/**
 * Patient directory row: initials avatar, name, phone, and a last-visit line.
 * White rounded row with generous spacing, per the reference's contact-list feel.
 */

import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { colors, radius, spacing } from '@/theme';
import type { Patient } from '@/types/domain';

export type PatientCardProps = {
  patient: Patient;
  onPress?: () => void;
  /** Optional short badge, e.g. "New" or "Due". */
  badge?: { label: string; background: string; color: string } | null;
  subtitle?: string;
};

export function PatientCard({ patient, onPress, badge, subtitle }: PatientCardProps) {
  const body = (
    <Card style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <Avatar name={patient.patient_name} size={44} elevated={false} />

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="cardTitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {patient.patient_name}
            </Text>
            {badge ? (
              <View
                style={{
                  backgroundColor: badge.background,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                }}
              >
                <Text variant="micro" color={badge.color} style={{ fontSize: 9 }}>
                  {badge.label}
                </Text>
              </View>
            ) : null}
          </View>

          {patient.mobile ? (
            <Text variant="caption" muted style={{ marginTop: 2 }}>
              {patient.mobile}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="micro" muted style={{ marginTop: 3 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} />
      </View>
    </Card>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${patient.patient_name}`}
    >
      {body}
    </Pressable>
  );
}
