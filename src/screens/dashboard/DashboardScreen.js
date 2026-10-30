import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BarChart } from 'react-native-chart-kit';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import StatCard from '../../components/StatCard';
import RosterRow from '../../components/RosterRow';
import EmptyState from '../../components/EmptyState';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { logoutOwner } from '../../services/authService';
import { supabase } from '../../services/supabase';
import { getTodaySummary, getWeeklyAttendanceCounts } from '../../services/recordsService';
import { getCompany } from '../../services/companyService';
import { getCompanySites } from '../../services/locationService';
import { deriveAttendanceStatus, deriveDisplayStatus, isManualEntry, isManualCheckout } from '../../utils/attendanceStatus';
import { SERIF_FONT, colorForIndex } from '../../constants/designTokens';
import { FREE_EMPLOYEE_LIMIT } from '../../services/employeeService';

const EMPLOYEE_LIMIT_WARNING_THRESHOLD = 15; // out of the 20-employee free-plan cap

// Mirrors the per-employee counting in recordsService.js's getTodaySummary —
// used to recompute the same stats for a branch-filtered subset without a
// second network round trip, since summary.statuses already has everything
// needed (including employee.site_id) from the one fetch on load().
function computeStats(statusItems) {
  let present = 0;
  let absent = 0;
  let checkedIn = 0;
  let checkedOut = 0;
  let late = 0;
  let singlePunch = 0;
  for (const item of statusItems) {
    if (item.status === 'in' || item.status === 'out') present++;
    else absent++;
    if (item.status === 'in') checkedIn++;
    if (item.status === 'out') checkedOut++;
    if (item.record?.is_late) late++;
    if (item.record?.check_in && !item.record?.check_out && item.record.status !== 'absent') singlePunch++;
  }
  return { present, absent, checkedIn, checkedOut, late, singlePunch, total: statusItems.length };
}

export default function DashboardScreen({ navigation, route }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();

  const { userData, faceRegistered } = useAuth();
  const companyId = userData?.company_id;
  const [loggingOut, setLoggingOut] = useState(false);
  const [summary, setSummary] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [company, setCompany] = useState(null);
  const [sites, setSites] = useState([]);
  const [branchFilter, setBranchFilter] = useState(route.params?.branchId ?? 'all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) {
      // Returning to Dashboard (e.g. via navigation.replace from the Menu)
      // remounts this screen with loading=true. If companyId isn't ready on
      // that first render, bailing out here without resetting loading left
      // the spinner stuck forever — only a full page reload could clear it.
      setLoading(false);
      return;
    }
    try {
      const [summaryData, weeklyData, companyData, siteData] = await Promise.all([
        getTodaySummary(companyId),
        getWeeklyAttendanceCounts(companyId),
        getCompany(companyId),
        getCompanySites(companyId),
      ]);
      setSummary(summaryData);
      setWeekly(weeklyData);
      setCompany(companyData);
      setSites(siteData);
    } catch (error) {
      // Without this, a failed fetch here silently left the dashboard
      // showing zero for everything with no indication anything went wrong.
      Toast.show({ type: 'error', text1: 'Could not load dashboard', text2: error.message });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live updates: refresh whenever an attendance row for this company changes
  // (e.g. a kiosk scan happening on another device).
  useEffect(() => {
    if (!companyId) return;
    const channelName = `attendance-company-${companyId}`;

    // Navigating away and back (e.g. Menu -> Back to Dashboard via
    // navigation.replace) remounts this screen fast enough that the
    // PREVIOUS instance's cleanup below hasn't finished removing its channel
    // yet. Supabase throws if you call .on() on a channel name that's
    // already subscribed, which crashed the whole screen with no error
    // boundary to catch it. Removing any stale channel with the same name
    // first makes this safe regardless of cleanup timing.
    const stale = supabase.getChannels().find((ch) => ch.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance', filter: `company_id=eq.${companyId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, load]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutOwner();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not log out', text2: error.message });
    } finally {
      setLoggingOut(false);
    }
  }

  function handleRefresh() {
    setRefreshing(true);
    load();
  }

  const chartWidth = Dimensions.get('window').width - 40;
  const chartData = {
    labels: weekly.map((d) => new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })),
    datasets: [{ data: weekly.map((d) => d.count) }],
  };

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const allStatuses = summary?.statuses ?? [];
  const filteredStatuses =
    branchFilter === 'all' ? allStatuses : allStatuses.filter((s) => s.employee.site_id === branchFilter);
  // 'all' reuses the numbers already computed server-side by
  // getTodaySummary — only a branch selection needs the client-side
  // recompute, so the common case does no extra work.
  const displayStats = branchFilter === 'all' ? summary : summary ? computeStats(filteredStatuses) : null;
  const selectedSite = branchFilter !== 'all' ? sites.find((s) => s.id === branchFilter) : null;

  const attendanceRate =
    displayStats?.total ? Math.round((displayStats.present / displayStats.total) * 100) : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const lateEmployees = filteredStatuses.filter((s) => s.record?.is_late).map((s) => s.employee.name);
  const absentEmployees = filteredStatuses.filter((s) => s.status === 'absent').map((s) => s.employee.name);

  // A manager can only ever reach Add Employee and Manual Attendance (see
  // MenuScreen.js) — these dashboard shortcuts must not bypass that by
  // jumping straight to Employees List / Attendance Records for them.
  const isManager = userData?.role === 'manager';
  const goToEmployeesList = isManager ? undefined : () => navigation.navigate('EmployeesList');
  const goToRecords = isManager ? undefined : () => navigation.navigate('AttendanceRecords');

  return (
    <FlatList
      style={styles.container}
      data={filteredStatuses}
      keyExtractor={(item) => item.employee.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      ListHeaderComponent={
        <>
          <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
            <TouchableOpacity onPress={() => navigation.replace('Menu')}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Hazri</Text>
            <View style={styles.menuButton} />
          </View>

          {!faceRegistered && (
            <TouchableOpacity style={styles.banner} onPress={() => navigation.navigate('FaceSetup')}>
              <Text style={styles.bannerText}>Face not registered. Tap here to set up face unlock.</Text>
            </TouchableOpacity>
          )}

          {company?.notification_preferences?.notify_employee_limit !== false &&
            (summary?.total ?? 0) >= EMPLOYEE_LIMIT_WARNING_THRESHOLD && (
              <TouchableOpacity
                style={styles.limitBanner}
                onPress={() => navigation.navigate('EmployeesList')}
              >
                <Text style={styles.limitBannerText}>
                  {summary.total >= FREE_EMPLOYEE_LIMIT
                    ? `You've reached the ${FREE_EMPLOYEE_LIMIT}-employee free-plan limit.`
                    : `Approaching your free-plan limit — ${summary.total} of ${FREE_EMPLOYEE_LIMIT} employees.`}
                </Text>
              </TouchableOpacity>
            )}

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Dashboard</Text>
              {selectedSite ? (
                <View style={[styles.customerIdBadge, { backgroundColor: colorForIndex(sites.indexOf(selectedSite)) + '22' }]}>
                  <Text style={[styles.customerIdText, { color: colorForIndex(sites.indexOf(selectedSite)) }]}>
                    {selectedSite.name}
                  </Text>
                </View>
              ) : company?.customer_id ? (
                <View style={styles.customerIdBadge}>
                  <Text style={styles.customerIdText}>{company.customer_id}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.subtitle}>
              {greeting}, {userData?.name || 'Owner'} · {todayLabel}
            </Text>

            {sites.length > 0 && (
              <View style={styles.branchTabs}>
                {[{ id: 'all', name: 'All' }, ...sites].map((site, index) => {
                  const selected = branchFilter === site.id;
                  const tabColor = site.id === 'all' ? colors.accent : colorForIndex(index - 1);
                  return (
                    <TouchableOpacity
                      key={site.id}
                      style={[
                        styles.branchTab,
                        { borderColor: selected ? tabColor : colors.border },
                        selected && { backgroundColor: tabColor + '22' },
                      ]}
                      onPress={() => setBranchFilter(site.id)}
                    >
                      <Text style={[styles.branchTabText, { color: selected ? tabColor : colors.textSecondary }]}>
                        {site.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {loading ? (
              <Text style={styles.loadingText}>Loading dashboard...</Text>
            ) : (
              <>
                {displayStats?.total ? (
                  <View style={styles.rateCard}>
                    <View style={styles.rateTop}>
                      <Text style={styles.rateLabel}>Today's Attendance Rate</Text>
                      <Text style={styles.rateValue}>{attendanceRate}%</Text>
                    </View>
                    <View style={styles.rateTrack}>
                      <View style={[styles.rateFill, { width: `${attendanceRate}%` }]} />
                    </View>
                  </View>
                ) : null}

                <View style={styles.gridRow}>
                  <StatCard label="Employees" value={displayStats?.total ?? 0} colorKey="accent" softKey="accentSoft" onPress={goToEmployeesList} />
                  <StatCard label="Present" value={displayStats?.present ?? 0} colorKey="success" softKey="successSoft" onPress={goToRecords} />
                  <StatCard label="Late" value={displayStats?.late ?? 0} colorKey="warning" softKey="warningSoft" onPress={goToRecords} />
                  <StatCard label="Absent" value={displayStats?.absent ?? 0} colorKey="error" softKey="errorSoft" onPress={goToRecords} />
                </View>
                <View style={styles.gridRow}>
                  <StatCard label="Checked In" value={displayStats?.checkedIn ?? 0} colorKey="info" softKey="infoSoft" onPress={goToRecords} />
                  <StatCard label="Checked Out" value={displayStats?.checkedOut ?? 0} colorKey="accent" softKey="accentSoft" onPress={goToRecords} />
                  <StatCard label="Single Punch" value={displayStats?.singlePunch ?? 0} colorKey="singlePunch" softKey="singlePunchSoft" onPress={goToRecords} />
                </View>

                {branchFilter === 'all' && sites.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>By Branch</Text>
                    {sites.map((site, index) => {
                      const siteStatuses = allStatuses.filter((s) => s.employee.site_id === site.id);
                      const sitePresent = siteStatuses.filter((s) => s.status === 'in' || s.status === 'out').length;
                      const siteColor = colorForIndex(index);
                      return (
                        <TouchableOpacity
                          key={site.id}
                          style={[styles.branchCard, { borderLeftColor: siteColor }]}
                          onPress={() => setBranchFilter(site.id)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.branchCardName}>{site.name}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.branchCardCount, { color: siteColor }]}>
                              {sitePresent}
                              <Text style={styles.branchCardTotal}>/{siteStatuses.length}</Text>
                            </Text>
                            <Text style={styles.branchCardLabel}>present</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                )}

                {(lateEmployees.length > 0 || absentEmployees.length > 0) && (
                  <View style={styles.namedListCard}>
                    {lateEmployees.length > 0 && (
                      <Text style={styles.namedListRow}>
                        <Text style={[styles.namedListLabel, { color: colors.warning }]}>Late: </Text>
                        {lateEmployees.join(', ')}
                      </Text>
                    )}
                    {absentEmployees.length > 0 && (
                      <Text style={styles.namedListRow}>
                        <Text style={[styles.namedListLabel, { color: colors.error }]}>Absent: </Text>
                        {absentEmployees.join(', ')}
                      </Text>
                    )}
                  </View>
                )}

                {weekly.length > 0 && (
                  <View style={styles.chartCard}>
                    <Text style={styles.chartTitle}>This Week — Employees Attended</Text>
                    <BarChart
                      data={chartData}
                      width={chartWidth}
                      height={180}
                      fromZero
                      chartConfig={{
                        backgroundColor: colors.card,
                        backgroundGradientFrom: colors.card,
                        backgroundGradientTo: colors.card,
                        decimalPlaces: 0,
                        color: (opacity = 1) =>
                          colors.isDark ? `rgba(129, 140, 248, ${opacity})` : `rgba(99, 102, 241, ${opacity})`,
                        labelColor: () => colors.textSecondary,
                        barPercentage: 0.6,
                      }}
                      style={styles.chart}
                    />
                  </View>
                )}

                <Text style={styles.sectionTitle}>Employee Status</Text>
              </>
            )}
          </View>
        </>
      }
      renderItem={({ item }) => {
        const time = (iso) =>
          iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
        const inTime = time(item.record?.check_in);
        const outTime = time(item.record?.check_out);
        const isManual = isManualEntry(item.record);
        const baseTimeLabel =
          item.status === 'out'
            ? `In ${inTime} · Out ${outTime}`
            : item.status === 'in'
            ? `In ${inTime}`
            : null;
        // Who marked it matters just as much as what was marked — a manual
        // entry with no visible "by X" leaves an admin unable to tell who
        // to ask if it looks wrong later.
        const markedByLabel = isManual && item.record?.marked_by_name ? `by ${item.record.marked_by_name}` : null;
        // Same for a hand-entered check-out (the "MO" badge) — and skip the
        // repeat when the same person entered both the check-in and check-out.
        const isManualOut = isManualCheckout(item.record);
        const outByName = item.record?.checkout_marked_by_name;
        const outByLabel =
          isManualOut && outByName && !(isManual && outByName === item.record?.marked_by_name)
            ? `out by ${outByName}`
            : null;
        const lateLabel = item.record?.is_late && item.status === 'out' ? 'Late' : null;
        const timeLabel =
          [baseTimeLabel, lateLabel, markedByLabel, outByLabel].filter(Boolean).join(' · ') || null;
        const rowStatus = deriveDisplayStatus(item.record);

        return (
          <View style={styles.rosterRowWrap}>
            <RosterRow
              name={item.employee.name}
              timeLabel={timeLabel}
              status={rowStatus}
              manual={isManual}
              manualCheckout={isManualOut}
            />
          </View>
        );
      }}
      ListEmptyComponent={
        !loading ? (
          <EmptyState
            icon="account-group-outline"
            title="No employees yet"
            description="Add your first employee to start tracking attendance."
          />
        ) : null
      }
      ListFooterComponent={
        <View style={styles.logoutButton}>
          <Button title="Log Out" onPress={handleLogout} loading={loggingOut} variant="outline" />
        </View>
      }
      contentContainerStyle={styles.listContent}
    />
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingBottom: 24,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 24,
      backgroundColor: colors.primary,
      borderBottomLeftRadius: colors.radiusLg,
      borderBottomRightRadius: colors.radiusLg,
    },
    headerTitle: {
      color: colors.white,
      fontSize: 18,
      fontWeight: '700',
    },
    backText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '600',
      opacity: 0.9,
    },
    menuButton: {
      width: 40,
    },
    banner: {
      backgroundColor: colors.isDark ? '#3F2F0E' : '#FFF3CD',
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    bannerText: {
      color: colors.isDark ? '#FDE68A' : '#856404',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    limitBanner: {
      backgroundColor: colors.isDark ? '#3F1D22' : '#F8D7DA',
      paddingVertical: 10,
      paddingHorizontal: 20,
    },
    limitBannerText: {
      color: colors.isDark ? '#FCA5A5' : '#842029',
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    content: {
      padding: 20,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontFamily: SERIF_FONT,
      fontWeight: '700',
      fontSize: 26,
      color: colors.textPrimary,
    },
    customerIdBadge: {
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
    },
    customerIdText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.accent,
      letterSpacing: 0.5,
    },
    subtitle: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 4,
      marginBottom: 16,
    },
    loadingText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    rateCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      padding: 16,
      marginBottom: 14,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: colors.isDark ? 0.3 : 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    rateTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    rateLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    rateValue: {
      fontFamily: SERIF_FONT,
      fontWeight: '700',
      fontSize: 20,
      color: colors.accent,
    },
    rateTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    rateFill: {
      height: '100%',
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    gridRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 10,
    },
    branchTabs: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
      marginBottom: 14,
    },
    branchTab: {
      borderWidth: 1,
      borderRadius: colors.radiusPill,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    branchTabText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 12,
    },
    branchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      borderLeftWidth: 4,
      padding: 14,
      marginBottom: 8,
    },
    branchCardName: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textPrimary,
    },
    branchCardCount: {
      fontFamily: SERIF_FONT,
      fontWeight: '700',
      fontSize: 20,
    },
    branchCardTotal: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
      fontSize: 13,
      color: colors.textSecondary,
    },
    branchCardLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 11,
      color: colors.textSecondary,
    },
    namedListCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      padding: 12,
      marginBottom: 16,
    },
    namedListRow: {
      fontSize: 12,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    namedListLabel: {
      fontWeight: '700',
    },
    chartCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      padding: 12,
      marginTop: 8,
      marginBottom: 16,
      alignItems: 'center',
    },
    chartTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    chart: {
      borderRadius: 8,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 8,
    },
    rosterRowWrap: {
      marginHorizontal: 20,
    },
    logoutButton: {
      marginHorizontal: 20,
      marginTop: 16,
    },
  });
}

