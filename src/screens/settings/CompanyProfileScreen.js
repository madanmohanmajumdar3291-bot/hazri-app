import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { getCompany, updateCompanyProfile, uploadCompanyLogo } from '../../services/companyService';

export default function CompanyProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { userData } = useAuth();
  const companyId = userData?.company_id;
  const [company, setCompany] = useState(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await getCompany(companyId);
      setCompany(data);
      setName(data?.company_name ?? '');
      setAddress(data?.address ?? '');
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not load company profile', text2: error.message });
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSave() {
    if (!name.trim()) {
      Toast.show({ type: 'error', text1: 'Company name is required' });
      return;
    }
    setSaving(true);
    try {
      const updated = await updateCompanyProfile(companyId, { company_name: name.trim(), address: address.trim() });
      setCompany(updated);
      Toast.show({ type: 'success', text1: 'Company profile updated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save changes', text2: error.message });
    } finally {
      setSaving(false);
    }
  }

  async function handlePickLogo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Toast.show({ type: 'error', text1: 'Photo library access is needed to choose a logo' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;

    setUploadingLogo(true);
    try {
      const updated = await uploadCompanyLogo(companyId, result.assets[0].uri);
      setCompany(updated);
      Toast.show({ type: 'success', text1: 'Logo updated' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not upload logo', text2: error.message });
    } finally {
      setUploadingLogo(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Company Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <TouchableOpacity style={styles.logoWrapper} onPress={handlePickLogo} disabled={uploadingLogo}>
        {company?.logo_url ? (
          <Image source={{ uri: company.logo_url }} style={styles.logoImage} />
        ) : (
          <View style={styles.logoPlaceholder}>
            <Text style={styles.logoPlaceholderText}>+ Logo</Text>
          </View>
        )}
        <Text style={styles.logoHint}>{uploadingLogo ? 'Uploading...' : 'Tap to change logo'}</Text>
      </TouchableOpacity>

      <Input label="Company Name" value={name} onChangeText={setName} placeholder="Your business name" />
      <Input
        label="Company Address"
        value={address}
        onChangeText={setAddress}
        placeholder="Full business address"
        multiline
      />

      {company?.customer_id ? (
        <View style={styles.readOnlyRow}>
          <Text style={styles.readOnlyLabel}>Customer ID</Text>
          <Text style={styles.readOnlyValue}>{company.customer_id}</Text>
        </View>
      ) : null}

      <Button title="Save Changes" onPress={handleSave} loading={saving} />
    </ScrollView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 20,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    loadingText: {
      color: colors.textSecondary,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 20,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    logoWrapper: {
      alignItems: 'center',
      marginBottom: 24,
    },
    logoImage: {
      width: 96,
      height: 96,
      borderRadius: 16,
      marginBottom: 8,
      backgroundColor: colors.card,
    },
    logoPlaceholder: {
      width: 96,
      height: 96,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    logoPlaceholderText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    logoHint: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: '600',
    },
    readOnlyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderRadius: 8,
      padding: 14,
      marginBottom: 20,
    },
    readOnlyLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    readOnlyValue: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.accent,
    },
  });
}

