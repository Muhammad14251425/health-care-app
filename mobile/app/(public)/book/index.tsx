/**
 * Step 1 -- choose a department.
 *
 * Soft coloured tiles inspired by the reference's "Your circles" grid. The list
 * is whatever the backend says is actually bookable; departments with no doctor
 * are never offered.
 */

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Activity, Baby, Bone, Brain, Ear, Eye, HeartPulse, Stethoscope } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { BookingProgress } from '@/components/booking/BookingSteps';
import * as publicApi from '@/api/publicBooking';
import { queryKeys } from '@/api/queryClient';
import { useBookingStore } from '@/stores/booking';
import { colors, radius, softTiles, spacing } from '@/theme';

/**
 * Marley ships ~24 standard departments. Mapping the common ones to an icon
 * keeps the grid legible; anything unmapped falls back to a stethoscope rather
 * than being hidden.
 */
const DEPARTMENT_ICONS: Record<string, LucideIcon> = {
  Cardiology: HeartPulse,
  Dermatology: Activity,
  ENT: Ear,
  'General Medicine': Stethoscope,
  Neurology: Brain,
  Orthopaedics: Bone,
  Maternity: Baby,
  Gynaecology: Baby,
  Physiotherapy: Bone,
  Ophthalmology: Eye,
};

export default function ChooseDepartment() {
  const router = useRouter();
  const setDepartment = useBookingStore((state) => state.setDepartment);

  const query = useQuery({
    queryKey: queryKeys.publicDepartments,
    queryFn: () => publicApi.listDepartments(),
  });

  const choose = (name: string) => {
    setDepartment(name);
    router.push('/(public)/book/practitioner');
  };

  return (
    <Screen>
      <BackHeader title="Book appointment" subtitle="Choose a department" />
      <BookingProgress step="department" />

      {query.isPending ? (
        <SkeletonList count={4} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data && query.data.items.length > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: spacing.md,
          }}
        >
          {query.data.items.map((department, index) => {
            const Icon = DEPARTMENT_ICONS[department.name] ?? Stethoscope;
            const background = softTiles[index % softTiles.length];

            return (
              <Pressable
                key={department.name}
                onPress={() => choose(department.name)}
                accessibilityRole="button"
                accessibilityLabel={department.label}
                style={{
                  // Two per row, accounting for the gap.
                  width: '48%',
                  flexGrow: 1,
                  backgroundColor: background,
                  borderRadius: radius.tile,
                  padding: spacing.lg,
                  minHeight: 112,
                  justifyContent: 'space-between',
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.md,
                    backgroundColor: 'rgba(255,255,255,0.6)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon size={18} color={colors.green} strokeWidth={1.8} />
                </View>
                <Text variant="cardTitle" numberOfLines={2}>
                  {department.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState
          title="No departments available"
          message="The clinic has not published any bookable departments yet. Please call us to book."
        />
      )}
    </Screen>
  );
}
