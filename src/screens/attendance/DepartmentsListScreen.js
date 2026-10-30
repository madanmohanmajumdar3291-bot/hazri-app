import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getCompanyDepartments, createDepartment, deleteDepartment } from '../../services/departmentService';
import Input from '../../components/Input';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';

export default function DepartmentsListScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;

  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const data = await getCompanyDepartments(companyId);
      setDepartments(data);
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load departments', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    load();
  }, [load]);

  function openAddModal() {
    setName('');
    setModalVisible(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Enter a department name' });
      return;
    }
    setSaving(true);
    try {
      await createDepartment({ companyId, name: name.trim() });
      setModalVisible(false);
      load();
      Toast.show({ type: 'success', text1: 'Department added' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not add department', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(department) {
    try {
      await deleteDepartment(department.id);
      setDepartments((prev) => prev.filter((d) => d.id !== department.id));
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not remove department', text2: error.message });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Departments</Text>
        <TouchableOpacity onPress={openAddModal}>
          <MaterialCommunityIcons name="plus" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={departments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="office-building-outline"
              title="No departments yet"
              description="Add departments like Sales, Kitchen, or Warehouse to organize your employees."
              actionLabel="Add Department"
              onAction={openAddModal}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowIconWrap}>
                <MaterialCommunityIcons name="office-building-outline" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{item.name}</Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={10}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView style={styles.modalScreen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Text style={styles.backText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Department</Text>
            <View style={{ width: 50 }} />
          </View>

          <View style={styles.formArea}>
            <Input label="Department Name" value={name} onChangeText={setName} placeholder="e.g. Kitchen" autoCapitalize="words" />
            <Button title="Save Department" onPress={handleSave} loading={saving} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
      paddingBottom: 16,
    },
    backText: { color: colors.accent, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
    title: { fontSize: 18, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    list: { paddingHorizontal: 20, paddingBottom: 24 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: colors.radiusMd,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 8,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
    modalScreen: { flex: 1, backgroundColor: colors.background },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 44,
      paddingBottom: 12,
    },
    modalTitle: { fontSize: 16, fontFamily: 'Sora_700Bold', color: colors.textPrimary },
    formArea: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24 },
  });
}
