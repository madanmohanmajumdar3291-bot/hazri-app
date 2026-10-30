import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getEmployees } from '../../services/employeeService';
import { getAttendanceRecords } from '../../services/recordsService';
import { generatePdfReport, generateExcelReport, shareFile } from '../../services/reportService';

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export default function ReportsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d;
  });
  const [toDate, setToDate] = useState(new Date());
  const [reportType, setReportType] = useState('team'); // 'team' | 'employee'
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [format, setFormat] = useState('pdf'); // 'pdf' | 'excel'
  const [generating, setGenerating] = useState(false);
  const [lastFile, setLastFile] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    getEmployees(companyId).then(setEmployees).catch(() => {});
  }, [companyId]);

  function changeDate(setter, current, offsetDays) {
    setter(() => {
      const next = new Date(current);
      next.setDate(next.getDate() + offsetDays);
      return next;
    });
  }

  async function handleGenerate() {
    if (reportType === 'employee' && !selectedEmployeeId) {
      Toast.show({ type: 'error', text1: 'Select an employee first' });
      return;
    }

    setGenerating(true);
    setLastFile(null);
    try {
      const from = toDateString(fromDate);
      const to = toDateString(toDate);
      const records = await getAttendanceRecords(companyId, {
        employeeId: reportType === 'employee' ? selectedEmployeeId : undefined,
        fromDate: from,
        toDate: to,
      });

      if (records.length === 0) {
        Toast.show({ type: 'info', text1: 'No records found', text2: 'No attendance data in this date range.' });
        return;
      }

      const result =
        format === 'pdf'
          ? await generatePdfReport({ companyName: userData?.name ? `${userData.name}'s Company` : 'Hazri', fromDate: from, toDate: to, records })
          : await generateExcelReport({ fromDate: from, toDate: to, records });

      setLastFile(result);
      await shareFile(result.uri);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not generate report', text2: error.message });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Reports</Text>
        <View style={styles.backSpacer} />
      </View>

      <View style={styles.content}>
        <Text style={styles.label}>Date Range</Text>
        <View style={styles.dateRow}>
          <View style={styles.dateBox}>
            <Text style={styles.dateBoxLabel}>From</Text>
            <View style={styles.dateArrowRow}>
              <TouchableOpacity onPress={() => changeDate(setFromDate, fromDate, -1)}>
                <Text style={styles.dateArrow}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.dateText}>{formatDisplayDate(fromDate)}</Text>
              <TouchableOpacity onPress={() => changeDate(setFromDate, fromDate, 1)}>
                <Text style={styles.dateArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.dateBox}>
            <Text style={styles.dateBoxLabel}>To</Text>
            <View style={styles.dateArrowRow}>
              <TouchableOpacity onPress={() => changeDate(setToDate, toDate, -1)}>
                <Text style={styles.dateArrow}>‹</Text>
              </TouchableOpacity>
              <Text style={styles.dateText}>{formatDisplayDate(toDate)}</Text>
              <TouchableOpacity onPress={() => changeDate(setToDate, toDate, 1)}>
                <Text style={styles.dateArrow}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Report Type</Text>
        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.optionChip, reportType === 'team' && styles.optionChipSelected]}
            onPress={() => setReportType('team')}
          >
            <Text style={[styles.optionText, reportType === 'team' && styles.optionTextSelected]}>Full Team</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionChip, reportType === 'employee' && styles.optionChipSelected]}
            onPress={() => setReportType('employee')}
          >
            <Text style={[styles.optionText, reportType === 'employee' && styles.optionTextSelected]}>
              Per Employee
            </Text>
          </TouchableOpacity>
        </View>

        {reportType === 'employee' && (
          <FlatList
            data={employees}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.employeeList}
            style={{ marginBottom: 16 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.employeeChip, selectedEmployeeId === item.id && styles.employeeChipSelected]}
                onPress={() => setSelectedEmployeeId(item.id)}
              >
                <Text
                  style={[
                    styles.employeeChipText,
                    selectedEmployeeId === item.id && styles.employeeChipTextSelected,
                  ]}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        <Text style={styles.label}>Export Format</Text>
        <View style={styles.optionRow}>
          <TouchableOpacity
            style={[styles.optionChip, format === 'pdf' && styles.optionChipSelected]}
            onPress={() => setFormat('pdf')}
          >
            <Text style={[styles.optionText, format === 'pdf' && styles.optionTextSelected]}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionChip, format === 'excel' && styles.optionChipSelected]}
            onPress={() => setFormat('excel')}
          >
            <Text style={[styles.optionText, format === 'excel' && styles.optionTextSelected]}>Excel</Text>
          </TouchableOpacity>
        </View>

        {generating && (
          <View style={styles.generatingRow}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.generatingText}>Generating report... this can take a few seconds</Text>
          </View>
        )}

        {lastFile && !generating && (
          <Text style={styles.fileInfo}>
            {lastFile.web
              ? format === 'pdf'
                ? 'Report opened in a new tab — use your browser\'s print dialog to save it as a PDF.'
                : 'Report downloaded to your device.'
              : `Report generated (${formatFileSize(lastFile.size)}) — share sheet opened.`}
          </Text>
        )}

        <Button title="Generate Report" onPress={handleGenerate} loading={generating} />
      </View>
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
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    content: {
      padding: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 8,
      marginTop: 8,
    },
    dateRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 8,
    },
    dateBox: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 10,
    },
    dateBoxLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    dateArrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    dateArrow: {
      fontSize: 20,
      color: colors.accent,
      paddingHorizontal: 6,
    },
    dateText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    optionRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 8,
    },
    optionChip: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    optionChipSelected: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    optionText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    optionTextSelected: {
      color: colors.accent,
    },
    employeeList: {
      gap: 8,
    },
    employeeChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      marginRight: 8,
      backgroundColor: colors.card,
    },
    employeeChipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    employeeChipText: {
      fontSize: 12,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    employeeChipTextSelected: {
      color: colors.white,
    },
    generatingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 16,
    },
    generatingText: {
      fontSize: 12,
      color: colors.textSecondary,
      flex: 1,
    },
    fileInfo: {
      fontSize: 12,
      color: colors.success,
      marginBottom: 12,
      textAlign: 'center',
    },
  });
}

