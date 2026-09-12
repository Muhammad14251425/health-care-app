/**
 * Patient directory.
 *
 * Search is debounced and served by the backend (which matches name, mobile,
 * email and id). Paging uses an infinite query so a long patient list never
 * arrives in one request.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SearchBar } from '@/components/ui/SearchBar';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import { PatientCard } from '@/components/clinic/PatientCard';
import * as patientsApi from '@/api/patients';
import { queryKeys } from '@/api/queryClient';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePermissions } from '@/stores/auth';
import { formatDate } from '@/utils/date';
import { colors, radius, screenPadding, shadows, spacing, tabBarClearance } from '@/theme';
import type { Patient } from '@/types/domain';

const PAGE_SIZE = 20;

export default function PatientsScreen() {
  const router = useRouter();
  const permissions = usePermissions();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);

  const query = useInfiniteQuery({
    queryKey: queryKeys.patients(debouncedSearch),
    queryFn: ({ pageParam }) =>
      patientsApi.listPatients({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        start: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

  const patients = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const total = query.data?.pages[0]?.total ?? 0;

  const renderItem = ({ item }: { item: Patient }) => (
    <PatientCard
      patient={item}
      subtitle={item.creation ? `Registered ${formatDate(item.creation.slice(0, 10))}` : undefined}
      onPress={() => router.push(`/(app)/patient/${encodeURIComponent(item.name)}`)}
    />
  );

  return (
    <Screen scroll={false} withTabBar padded={false}>
      <View style={{ paddingHorizontal: screenPadding }}>
        <ScreenHeader
          title="Patients"
          subtitle={total > 0 ? `${total} registered` : undefined}
          right={
            permissions.canCreatePatient ? (
              <Pressable
                onPress={() => router.push('/(app)/patient/new')}
                accessibilityRole="button"
                accessibilityLabel="Add patient"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.pill,
                  backgroundColor: colors.green,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...shadows.raised,
                }}
              >
                <UserPlus size={19} color={colors.gold} strokeWidth={2.2} />
              </Pressable>
            ) : undefined
          }
        />

        <View style={{ marginBottom: spacing.lg }}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone or ID"
          />
        </View>
      </View>

      {query.isPending ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <SkeletonList count={6} />
        </View>
      ) : query.isError ? (
        <View style={{ paddingHorizontal: screenPadding }}>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={patients}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: tabBarClearance,
          }}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator color={colors.green} style={{ marginVertical: spacing.lg }} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              title={debouncedSearch ? 'No patients found' : 'No patients yet'}
              message={
                debouncedSearch
                  ? 'No patients match your search.'
                  : 'Patients you register will appear here.'
              }
              action={
                permissions.canCreatePatient
                  ? { label: 'Add a patient', onPress: () => router.push('/(app)/patient/new') }
                  : undefined
              }
            />
          }
        />
      )}
    </Screen>
  );
}
