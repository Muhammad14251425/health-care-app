/**
 * All reports.
 *
 * Every desk report the clinic has, grouped by module. The list is what the
 * SERVER says this user may run -- a doctor sees Healthcare only, because the
 * financial modules are gated on billing roles, so nothing here leads to a 403.
 */

import { useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileSearch } from 'lucide-react-native';

import { Screen } from '@/components/ui/Screen';
import { BackHeader } from '@/components/ui/ScreenHeader';
import { Card } from '@/components/ui/Card';
import { Text } from '@/components/ui/Text';
import { SearchBar } from '@/components/ui/SearchBar';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/States';
import * as runner from '@/api/reportRunner';
import { queryKeys } from '@/api/queryClient';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { colors, radius, screenPadding, spacing } from '@/theme';
import { Pressable } from 'react-native';

/** Plain-English names for ERPNext's module labels. */
const MODULE_LABELS: Record<string, string> = {
  Healthcare: 'Clinical',
  Accounts: 'Accounting & billing',
  Selling: 'Sales & customers',
};

export default function BrowseReportsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);

  const query = useQuery({
    queryKey: queryKeys.report('list', debounced || 'all'),
    queryFn: () => runner.listReports(debounced || undefined),
  });

  const sections = useMemo(() => {
    const byModule = new Map<string, runner.ReportSummary[]>();
    for (const item of query.data?.items ?? []) {
      byModule.set(item.module, [...(byModule.get(item.module) ?? []), item]);
    }
    return [...byModule.entries()].map(([module, data]) => ({
      title: MODULE_LABELS[module] ?? module,
      count: data.length,
      data,
    }));
  }, [query.data]);

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ paddingHorizontal: screenPadding }}>
        <BackHeader
          title="All reports"
          subtitle={
            query.data ? `${query.data.total} available` : 'Everything the clinic can run'
          }
        />
        <View style={{ marginBottom: spacing.md }}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search reports"
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
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.name}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{
            paddingHorizontal: screenPadding,
            paddingBottom: spacing.xxxl,
          }}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          renderSectionHeader={({ section }) => (
            <Text
              variant="label"
              muted
              style={{ marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.6 }}
            >
              {section.title.toUpperCase()} · {section.count}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              // Object form, not a template string: report names contain spaces
              // and "&" (e.g. "Delivered Items To Be Billed"), and expo-router
              // handles the encoding correctly when the param is passed apart
              // from the path.
              onPress={() =>
                router.push({
                  pathname: '/(app)/reports/[name]',
                  params: { name: item.name },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
            >
              <Card style={{ marginBottom: spacing.sm }} padding={spacing.md}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.md,
                      backgroundColor: colors.mint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <FileSearch size={16} color={colors.green} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="cardTitle" numberOfLines={2}>
                      {item.name}
                    </Text>
                    {item.ref_doctype ? (
                      <Text variant="micro" muted numberOfLines={1} style={{ marginTop: 2 }}>
                        {item.ref_doctype}
                      </Text>
                    ) : null}
                  </View>
                  <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} />
                </View>
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              title="No reports found"
              message={
                debounced
                  ? `Nothing matches "${debounced}".`
                  : 'No reports are available to your role.'
              }
            />
          }
        />
      )}
    </Screen>
  );
}
