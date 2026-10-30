import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import CameraCapture from '../../components/CameraCapture';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { generateEmbedding, findDuplicateFaceOwner, withTimeout } from '../../services/faceService';
import { averageEmbeddings } from '../../utils/faceUtils';
import { getEmployee, saveEmployeeFace } from '../../services/employeeService';

const STEPS = [
  { label: 'Step 1', instruction: 'Ask them to look straight at the camera' },
  { label: 'Step 2', instruction: 'Ask them to turn their head slightly left' },
  { label: 'Step 3', instruction: 'Ask them to turn their head slightly right' },
];

export default function EmployeeFaceSetupScreen({ route, navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { employeeId } = route.params;
  const [employee, setEmployee] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [embeddings, setEmbeddings] = useState([]);
  const [frontPhotoUri, setFrontPhotoUri] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [readyToRetrySave, setReadyToRetrySave] = useState(false);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getEmployee(employeeId).then(setEmployee).catch(() => {});
    }, [employeeId])
  );

  async function handleCapture(uri) {
    setProcessing(true);
    setError('');

    let result;
    try {
      result = await withTimeout(generateEmbedding(uri), 8000);
    } catch (timeoutError) {
      result = { success: false, error: timeoutError.message };
    }
    setProcessing(false);

    if (!result.success) {
      setStatus('error');
      setError(result.error);
      return;
    }

    setStatus('detected');
    const nextEmbeddings = [...embeddings, result.embedding];
    setEmbeddings(nextEmbeddings);
    // Step 0 is "look straight at the camera" — the one usable ID photo out
    // of the three capture angles.
    if (stepIndex === 0) setFrontPhotoUri(uri);

    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
      setStatus('idle');
    } else {
      await finishRegistration(nextEmbeddings);
    }
  }

  async function finishRegistration(allEmbeddings, skipDuplicateCheck = false) {
    setSaving(true);
    setError('');
    try {
      const masterEmbedding = averageEmbeddings(allEmbeddings);

      if (employee?.company_id && !skipDuplicateCheck) {
        const duplicateName = await findDuplicateFaceOwner(employee.company_id, masterEmbedding, {
          excludeEmployeeId: employeeId,
        });
        if (duplicateName) {
          setError(
            `This looks similar to ${duplicateName}'s registered face. If you're sure this is a mistake, you can save anyway.`
          );
          setDuplicateBlocked(true);
          setSaving(false);
          setReadyToRetrySave(false);
          return;
        }
      }

      setDuplicateBlocked(false);
      await saveEmployeeFace(employeeId, masterEmbedding, frontPhotoUri, allEmbeddings);
      Toast.show({ type: 'success', text1: 'Face registered successfully' });
      navigation.replace('EmployeeDetail', { employeeId });
    } catch (e) {
      // Never navigate away on a failed save — the owner would think it
      // worked and only discover otherwise much later.
      setError('Could not save face data. Please check your connection and try again.');
      setReadyToRetrySave(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.stepsRow}>
          {STEPS.map((step, index) => (
            <Text
              key={step.label}
              style={[styles.stepLabel, index === stepIndex && styles.activeStepLabel]}
            >
              {step.label}
            </Text>
          ))}
        </View>
      </View>

      <Text style={styles.intro}>
        Register {employee?.name || 'Employee'}'s Face
      </Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.cameraWrapper}>
        <CameraCapture
          onCapture={handleCapture}
          onCancel={() => navigation.replace('EmployeeDetail', { employeeId })}
          instruction={STEPS[stepIndex].instruction}
          processing={processing}
          status={status}
          defaultFacing="back"
        />
      </View>

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={colors.white} size="large" />
          <Text style={styles.savingText}>Saving...</Text>
        </View>
      )}

      {!saving && duplicateBlocked && (
        <View style={styles.retryContainer}>
          <Button title="Save Anyway" onPress={() => finishRegistration(embeddings, true)} />
          <View style={{ height: 10 }} />
          <Button
            title="Retake Photos"
            variant="outline"
            onPress={() => {
              setStepIndex(0);
              setEmbeddings([]);
              setStatus('idle');
              setError('');
              setDuplicateBlocked(false);
            }}
          />
        </View>
      )}
      {!saving && readyToRetrySave && !duplicateBlocked && (
        <View style={styles.retryContainer}>
          <Button title="Retry Save" onPress={() => finishRegistration(embeddings)} />
        </View>
      )}
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
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    stepsRow: {
      flexDirection: 'row',
      gap: 12,
    },
    stepLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    activeStepLabel: {
      color: colors.accent,
    },
    intro: {
      fontSize: 14,
      color: colors.textSecondary,
      paddingHorizontal: 20,
      marginTop: 12,
      marginBottom: 8,
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    cameraWrapper: {
      flex: 1,
    },
    savingOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.7)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    savingText: {
      color: colors.white,
      marginTop: 12,
      fontSize: 16,
      fontWeight: '600',
    },
    retryContainer: {
      position: 'absolute',
      bottom: 100,
      left: 20,
      right: 20,
    },
  });
}

