/**
 * Welcome -- the fork between booking as a member of the public and signing in
 * as staff. Deliberately restrained: no large illustration, per the design brief.
 */

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarPlus, Smartphone } from 'lucide-react-native';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/Logo';
import { HeroCard } from '@/components/ui/HeroCard';
import { colors, spacing } from '@/theme';

export default function Welcome() {
  const router = useRouter();

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingBottom: spacing.xl }}>
        <View style={{ paddingTop: spacing.xxxl }}>
          <Logo />
          <Text variant="heading1" style={{ marginTop: spacing.md }}>
            Care that fits{'\n'}around your day.
          </Text>
          <Text variant="body" muted style={{ marginTop: spacing.md, maxWidth: 300 }}>
            Sign in to see your appointments and records, or book as a guest in
            under a minute.
          </Text>
        </View>

        <View style={{ marginVertical: spacing.xl }}>
          <HeroCard
            label="Next available today"
            value="Same day"
            caption="Choose a doctor, pick a time, and you're done."
          />
        </View>

        <View style={{ gap: spacing.md }}>
          {/* Patients with an account get the richer, authenticated flow: their
              appointments, records and invoices -- not just a booking form. */}
          <Button
            label="Patient login"
            onPress={() => router.push('/(patient-auth)/phone')}
            icon={<Smartphone size={17} color={colors.white} strokeWidth={2} />}
          />
          <Button
            label="Book as a guest"
            variant="secondary"
            onPress={() => router.push('/(public)/book')}
            icon={<CalendarPlus size={17} color={colors.green} strokeWidth={2} />}
          />
          <Button
            label="Staff sign in"
            variant="ghost"
            onPress={() => router.push('/(public)/login')}
          />
          <Text variant="micro" muted align="center" style={{ marginTop: spacing.sm }}>
            Need help? Call the clinic on 021 111 000 111
          </Text>
        </View>
      </View>
    </Screen>
  );
}
