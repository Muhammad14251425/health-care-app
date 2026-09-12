/**
 * The patient's own profile ("Me").
 *
 * Editable here: email and a secondary phone. NOT editable: name, date of birth,
 * gender, blood group, patient id -- those are clinical identity, corrected by
 * clinic staff against evidence rather than self-asserted from a phone. The
 * backend enforces this (its allowlist is two fields wide); the lock icons here
 * just explain why.
 *
 * The login number is changed through its own OTP-verified flow, because it IS
 * the credential -- see /(patient)/profile/phone.
 */

import { View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  HelpCircle,
  LogOut,
  Mail,
  Phone,
  Shield,
  User as UserIcon,
} from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { SettingsRow } from '@/components/ui/SettingsRow';
import { SectionHeader } from '@/components/ui/ScreenHeader';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import * as patientApi from '@/api/patient';
import { queryKeys } from '@/api/queryClient';
import { useAuth } from '@/stores/auth';
import { formatCurrencyCompact } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { colors, radius, spacing, typography } from '@/theme';

export default function PatientProfileScreen() {
  const { signOut } = useAuth();
  const toast = useToast();

  const query = useQuery({
    queryKey: queryKeys.patientMe,
    queryFn: patientApi.me,
  });

  const profile = query.data;

  const onSignOut = async () => {
    try {
      await signOut();
    } catch {
      toast.error('Could not sign out cleanly, but your session was cleared.');
    } finally {
      // signOut clears the query cache; land on the public entry either way.
      router.replace('/(public)/welcome');
    }
  };

  return (
    <Screen
      withTabBar
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <SkeletonList count={5} />
      ) : (
        <>
          {/* Identity */}
          <View style={{ alignItems: 'center', marginTop: spacing.md }}>
            <Avatar name={profile?.patient_name ?? '?'} size={78} />
            <Text style={[typography.heading2, { marginTop: spacing.md }]}>
              {profile?.patient_name ?? 'Patient'}
            </Text>
            <Text variant="caption" muted style={{ marginTop: 2 }}>
              {profile?.login_phone ?? profile?.mobile_display ?? profile?.mobile ?? ''}
            </Text>
            <View
              style={{
                marginTop: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: 4,
                borderRadius: radius.pill,
                backgroundColor: colors.mint,
              }}
            >
              <Text variant="micro" color={colors.green}>
                {profile?.patient_id ?? ''}
              </Text>
            </View>

            <Button
              label="Edit profile"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/(patient)/profile/edit')}
              style={{ marginTop: spacing.md }}
            />
          </View>

          {/* Stats */}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
            <Stat label="Visits" value={String(profile?.visits ?? 0)} />
            <Stat label="Upcoming" value={String(profile?.upcoming ?? 0)} />
            <Stat
              label="Due"
              value={formatCurrencyCompact(profile?.outstanding ?? 0)}
            />
          </View>

          {/* Personal information -- read only, and shown as such. */}
          <SectionHeader title="Personal information" style={{ marginTop: spacing.xl }} />
          <Card flush>
            <SettingsRow
              icon={<UserIcon size={17} color={colors.green} strokeWidth={1.8} />}
              label="Full name"
              value={profile?.patient_name ?? '—'}
            />
            <SettingsRow
              icon={<UserIcon size={17} color={colors.green} strokeWidth={1.8} />}
              label="Date of birth"
              value={profile?.dob ? formatDate(profile.dob) : 'Not recorded'}
            />
            <SettingsRow
              icon={<UserIcon size={17} color={colors.green} strokeWidth={1.8} />}
              label="Gender"
              value={profile?.sex ?? '—'}
            />
            <SettingsRow
              icon={<UserIcon size={17} color={colors.green} strokeWidth={1.8} />}
              label="Blood group"
              value={profile?.blood_group ?? 'Not recorded'}
              last
            />
          </Card>
          <Text variant="micro" muted style={{ marginTop: spacing.sm }}>
            Ask the clinic to correct any of these details.
          </Text>

          {/* Contact -- the parts a patient may change. */}
          <SectionHeader title="Contact information" style={{ marginTop: spacing.xl }} />
          <Card flush>
            <SettingsRow
              icon={<Phone size={17} color={colors.green} strokeWidth={1.8} />}
              label="Mobile (login)"
              value={profile?.login_phone ?? profile?.mobile_display ?? '—'}
              onPress={() => router.push('/(patient)/profile/phone')}
            />
            <SettingsRow
              icon={<Mail size={17} color={colors.green} strokeWidth={1.8} />}
              label="Email"
              value={profile?.email ?? 'Add an email'}
              onPress={() => router.push('/(patient)/profile/edit')}
            />
            <SettingsRow
              icon={<Phone size={17} color={colors.green} strokeWidth={1.8} />}
              label="Other phone"
              value={profile?.phone ?? 'Not set'}
              onPress={() => router.push('/(patient)/profile/edit')}
              last
            />
          </Card>

          {/* Account */}
          <SectionHeader title="Account & support" style={{ marginTop: spacing.xl }} />
          <Card flush>
            <SettingsRow
              icon={<Shield size={17} color={colors.green} strokeWidth={1.8} />}
              label="Account & security"
              value={
                profile?.phone_verified_on
                  ? `Verified ${formatDate(profile.phone_verified_on)}`
                  : 'Phone verified'
              }
              onPress={() => router.push('/(patient)/profile/phone')}
            />
            <SettingsRow
              icon={<Bell size={17} color={colors.green} strokeWidth={1.8} />}
              label="Notifications"
              value="Coming soon"
            />
            <SettingsRow
              icon={<HelpCircle size={17} color={colors.green} strokeWidth={1.8} />}
              label="Help & support"
              value="Contact the clinic"
              last
            />
          </Card>

          <Button
            label="Log out"
            variant="danger"
            icon={<LogOut size={17} color={colors.white} strokeWidth={1.9} />}
            onPress={onSignOut}
            fullWidth
            style={{ marginTop: spacing.xl }}
          />
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[typography.heading2, { fontSize: 20 }]}>{value}</Text>
      <Text variant="micro" muted style={{ marginTop: 2 }}>
        {label}
      </Text>
    </Card>
  );
}
