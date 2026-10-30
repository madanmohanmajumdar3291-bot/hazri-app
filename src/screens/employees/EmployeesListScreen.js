import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, SectionList, TouchableOpacity, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import EmployeeCard from '../../components/EmployeeCard';
import { colorForIndex } from '../../constants/designTokens';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees, FREE_EMPLOYEE_LIMIT } from '../../services/employeeService';
import { getCompanySites } from '../../services/locationService';
import { getCompanyDepartments } from '../../services/departmentService';

export default function EmployeesListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [employees, setEmployees] = useState([]);
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [branchFilter, setBranchFilter] = useState('all'); // 'all' | 'none' | site id
  const [departmentFilter, setDepartmentFilter] = useState('all'); // 'all' | 'none' | department id
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadEmployees = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [data, siteList, departmentList] = await Promise.all([
        getEmployees(companyId),
        getCompanySites(companyId),
        getCompanyDepartments(companyId),
      ]);
      setEmployees(data);
      setSites(siteList);
      setDepartments(departmentList);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load employees', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      loadEmployees();
    }, [loadEmployees])
  );

  const count = employees.length;
  const isLocked = count >= FREE_EMPLOYEE_LIMIT;
  const progressColor = count >= FREE_EMPLOYEE_LIMIT ? colors.error : count >= 15 ? colors.warning : colors.success;

  const filtered = employees.filter((e) => {
    const matchesSearch = e.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchesBranch =
      branchFilter === 'all' ? true : branchFilter === 'none' ? !e.site_id : e.site_id === branchFilter;
    const matchesDepartment =
      departmentFilter === 'all'
        ? true
        : departmentFilter === 'none'
        ? !e.department_id
        : e.department_id === departmentFilter;
    return matchesSearch && matchesBranch && matchesDepartment;
  });

  // Grouped by branch so employees are visually separated by which site
  // they belong to, instead of one flat list — each site keeps its own
  // section in the same order sites were added, with unassigned employees
  // collected into a trailing "No Branch" section.
  const sections = useMemo(() => {
    const bySite = new Map();
    for (const site of sites) bySite.set(site.id, { title: site.name, data: [] });
    const noBranch = { title: 'No Branch', data: [] };

    for (const employee of filtered) {
      const bucket = employee.site_id ? bySite.get(employee.site_id) : null;
      (bucket ?? noBranch).data.push(employee);
    }

    const result = [...bySite.values()].filter((section) => section.data.length > 0);
    if (noBranch.data.length > 0) result.push(noBranch);
    return result;
  }, [filtered, sites]);

  function handleAddEmployee() {
    if (isLocked) return;
    navigation.navigate('AddEmployee');
  }

  function handleLongPress(employee) {
    navigation.navigate('EmployeeDetail', { employeeId: employee.id });
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Employees</Text>
        {!isLocked ? (
          <TouchableOpacity style={styles.addButton} onPress={handleAddEmployee}>
            <Text style={styles.addButtonText}>+ Add Employee</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backSpacer} />
        )}
      </View>

      <View style={styles.countSection}>
        <Text style={styles.countText}>
          {count} of {FREE_EMPLOYEE_LIMIT} employees (Free Plan)
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min((count / FREE_EMPLOYEE_LIMIT) * 100, 100)}%`, backgroundColor: progressColor },
            ]}
          />
        </View>
      </View>

      {isLocked && (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedText}>
            You've reached the 20 employee free limit. Upgrade to add more.
          </Text>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() =>
              Toast.show({ type: 'info', text1: 'Upgrade plans are coming soon' })
            }
          >
            <Text style={styles.upgradeButtonText}>Upgrade</Text>
          </TouchableOpacity>
        </View>
      )}

      <TextInput
        style={styles.searchInput}
        placeholder="Search employees by name"
        placeholderTextColor={colors.textSecondary}
        value={search}
        onChangeText={setSearch}
      />

      {sites.length > 0 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.branchFilterRow}
          contentContainerStyle={styles.branchFilterContent}
          data={[{ id: 'all', name: 'All Branches' }, ...sites, { id: 'none', name: 'No Branch' }]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.branchChip, branchFilter === item.id && styles.branchChipSelected]}
              onPress={() => setBranchFilter(item.id)}
            >
              <Text style={[styles.branchChipText, branchFilter === item.id && styles.branchChipTextSelected]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {departments.length > 0 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.branchFilterRow}
          contentContainerStyle={styles.branchFilterContent}
          data={[{ id: 'all', name: 'All Departments' }, ...departments, { id: 'none', name: 'No Department' }]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.branchChip, departmentFilter === item.id && styles.branchChipSelected]}
              onPress={() => setDepartmentFilter(item.id)}
            >
              <Text style={[styles.branchChipText, departmentFilter === item.id && styles.branchChipTextSelected]}>
                {item.name}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={loading}
        onRefresh={loadEmployees}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const deptIndex = departments.findIndex((d) => d.id === item.department_id);
          return (
            <EmployeeCard
              employee={item}
              departmentName={deptIndex >= 0 ? departments[deptIndex].name : undefined}
              departmentColor={deptIndex >= 0 ? colorForIndex(deptIndex) : undefined}
              onPress={() => navigation.navigate('EmployeeDetail', { employeeId: item.id })}
              onLongPress={() => handleLongPress(item)}
            />
          );
        }}
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyText}>
                No employees added yet. Tap 'Add Employee' to get started.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 8,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    backSpacer: {
      width: 40,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    addButton: {
      backgroundColor: colors.accent,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 8,
    },
    addButtonText: {
      color: colors.white,
      fontWeight: '600',
      fontSize: 13,
    },
    countSection: {
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    countText: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    progressTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 4,
    },
    lockedBanner: {
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.isDark ? '#3F1D22' : '#F8D7DA',
      borderRadius: 8,
      padding: 12,
    },
    lockedText: {
      color: colors.isDark ? '#FCA5A5' : '#842029',
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    upgradeButton: {
      alignSelf: 'flex-start',
      backgroundColor: colors.error,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
    },
    upgradeButtonText: {
      color: colors.white,
      fontWeight: '600',
      fontSize: 12,
    },
    searchInput: {
      marginHorizontal: 20,
      marginBottom: 12,
      height: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 14,
      backgroundColor: colors.card,
      color: colors.textPrimary,
    },
    branchFilterRow: {
      marginBottom: 12,
      flexGrow: 0,
    },
    branchFilterContent: {
      paddingHorizontal: 20,
      gap: 8,
    },
    branchChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: colors.card,
    },
    branchChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    branchChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    branchChipTextSelected: {
      color: colors.white,
    },
    list: {
      paddingHorizontal: 20,
      paddingBottom: 24,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.background,
      paddingTop: 12,
      paddingBottom: 8,
    },
    sectionHeaderText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    sectionHeaderCount: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 60,
      paddingHorizontal: 32,
    },
    emptyIcon: {
      fontSize: 48,
      marginBottom: 12,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
}

