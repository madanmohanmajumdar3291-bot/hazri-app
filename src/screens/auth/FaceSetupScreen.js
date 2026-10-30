import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import CameraCapture from '../../components/CameraCapture';
import Button from '../../components/Button';
import { useTheme } from '../../context/ThemeContext';
import { generateEmbedding, findDuplicateFaceOwner, withTimeout } from '../../services/faceService';
import { averageEmbeddings } from '../../utils/faceUtils';
import { useAuth } from '../../context/AuthContext';
import { skipFaceRegistration } from '../../services/authService';
import { hasAnyShift } from '../../services/shiftService';

const STEPS = [
  { label: '1', instruction: 'Look straight at the camera' },
  { label: '2', instruction: 'Turn your head slightly to the left' },
  { label: '3', instruction: 'Turn your head slightly to the right' },
];

// idle | capturing | processing | success | error, tracked per step so each
// step's indicator can show its own state independent of the others.
async function goToDashboardOrShiftSetup(navigation, companyId) {
  try {
    const alreadyHasShift = companyId ? await hasAnyShift(companyId) : true;
    navigation.replace(alreadyHasShift ? 'Home' : 'ShiftSetup');
  } catch (_error) {
    // If the check fails for any reason, don't block the owner from
    // reaching the app — they can still set up a shift later from the menu.
    navigation.replace('Home');
  }
}

export default function FaceSetupScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { firebaseUser, userData, saveFaceEmbedding, setUserData, pendingFaceSetup, setPendingFaceSetup } = useAuth();
  // Captured once at mount — this screen is reused for both first-time
  // onboarding (must continue into the app) and re-registering an already
  // set up face from Settings/Profile (should just return there), and
  // finishRegistration() clears pendingFaceSetup before we'd otherwise know
  // which case this was.
  const [isReRegister] = useState(!pendingFaceSetup);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepStates, setStepStates] = useState(['idle', 'idle', 'idle']);
  const [embeddings, setEmbeddings] = useState([]);
  const [frontPhotoUri, setFrontPhotoUri] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [error, setError] = useState('');
  const [justCaptured, setJustCaptured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);

  function setStepState(index, state) {
    setStepStates((prev) => prev.map((s, i) => (i === index ? state : s)));
  }

  function resetCapture() {
    setStepIndex(0);
    setStepStates(['idle', 'idle', 'idle']);
    setEmbeddings([]);
    setCameraStatus('idle');
    setError('');
    setDuplicateBlocked(false);
  }

  async function handleCapture(uri) {
    setProcessing(true);
    setError('');
    setStepState(stepIndex, 'processing');

    let result;
    try {
      result = await withTimeout(generateEmbedding(uri), 8000);
    } catch (timeoutError) {
      result = { success: false, error: timeoutError.message };
    }

    setProcessing(false);

    if (!result.success) {
      setCameraStatus('error');
      setStepState(stepIndex, 'error');
      setError(result.error);
      return;
    }

    setCameraStatus('detected');
    setStepState(stepIndex, 'success');
    setJustCaptured(true);

    const nextEmbeddings = [...embeddings, result.embedding];
    setEmbeddings(nextEmbeddings);
    // Step 0 is "look straight at the camera" — the one usable ID photo.
    if (stepIndex === 0) setFrontPhotoUri(uri);

    setTimeout(async () => {
      setJustCaptured(false);
      if (stepIndex < STEPS.length - 1) {
        setStepIndex(stepIndex + 1);
        setCameraStatus('idle');
      } else {
        await finishRegistration(nextEmbeddings);
      }
    }, 1000);
  }

  async function finishRegistration(allEmbeddings, skipDuplicateCheck = false) {
    setSaving(true);
    setError('');
    try {
      const masterEmbedding = averageEmbeddings(allEmbeddings);

      if (userData?.company_id && !skipDuplicateCheck) {
        const duplicateName = await findDuplicateFaceOwner(userData.company_id, masterEmbedding, {
          excludeUserId: firebaseUser?.id,
        });
        if (duplicateName) {
          setError(
            `This looks similar to ${duplicateName}'s registered face. If you're sure this is a mistake, you can save anyway.`
          );
          setDuplicateBlocked(true);
          setSaving(false);
          return;
        }
      }

      setDuplicateBlocked(false);
      await saveFaceEmbedding(masterEmbedding, frontPhotoUri, allEmbeddings);
      setPendingFaceSetup(false);
      Toast.show({ type: 'success', text1: 'Face registered successfully' });

      if (isReRegister) {
        // Came from Settings/Profile via navigate() — goBack() returns there
        // directly instead of dumping the admin onto Home with no way back.
        navigation.goBack();
      } else {
        await goToDashboardOrShiftSetup(navigation, userData?.company_id);
      }
    } catch (saveError) {
      // Never navigate on a failed save — let the owner retry from here.
      setError('Could not save your face data. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    Alert.alert(
      'Skip face registration?',
      'Without face registration you cannot unlock the admin menu. Are you sure you want to skip?',
      [
        { text: 'Continue setup', style: 'cancel' },
        {
          text: 'Skip for now',
          style: 'destructive',
          onPress: async () => {
            const updated = await skipFaceRegistration(firebaseUser.id);
            setUserData(updated);
            setPendingFaceSetup(false);
            await goToDashboardOrShiftSetup(navigation, updated?.company_id ?? userData?.company_id);
          },
        },
      ]
    );
  }

  function stepIcon(state, label) {
    if (state === 'success') return '✓';
    if (state === 'error') return '✕';
    return label;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.stepsRow}>
          {STEPS.map((step, index) => {
            const state = stepStates[index];
            return (
              <View
                key={step.label}
                style={[
                  styles.stepCircle,
                  state === 'success' && styles.stepCircleSuccess,
                  state === 'error' && styles.stepCircleError,
                  index === stepIndex && state === 'idle' && styles.stepCircleActive,
                ]}
              >
                {state === 'processing' ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text
                    style={[
                      styles.stepCircleText,
                      (state === 'success' || state === 'error') && styles.stepCircleTextLight,
                    ]}
                  >
                    {stepIcon(state, step.label)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
        {isReRegister ? (
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.skipText}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={handleSkip}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.intro}>
        {isReRegister
          ? "Let's re-register your face."
          : "Let's register your face. This will be used to unlock the admin menu."}
      </Text>
      {justCaptured ? <Text style={styles.successText}>Face captured! ✓</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.cameraWrapper}>
        <CameraCapture
          onCapture={handleCapture}
          onCancel={() => {
            if (isReRegister) {
              navigation.goBack();
            } else {
              setPendingFaceSetup(false);
              goToDashboardOrShiftSetup(navigation, userData?.company_id);
            }
          }}
          instruction={STEPS[stepIndex].instruction}
          processing={processing}
          status={cameraStatus}
        />
      </View>

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={colors.white} size="large" />
          <Text style={styles.savingText}>Saving...</Text>
        </View>
      )}

      {!saving && error && stepIndex === STEPS.length - 1 && stepStates[stepIndex] === 'success' && (
        <View style={styles.retrySaveContainer}>
          {duplicateBlocked ? (
            <>
              <Button title="Save Anyway" onPress={() => finishRegistration(embeddings, true)} />
              <View style={{ height: 10 }} />
              <Button title="Retake Photos" variant="outline" onPress={resetCapture} />
            </>
          ) : (
            <Button title="Retry Save" onPress={() => finishRegistration(embeddings)} />
          )}
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
    stepCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.border,
    },
    stepCircleActive: {
      backgroundColor: colors.accentSoft,
    },
    stepCircleSuccess: {
      backgroundColor: colors.success,
    },
    stepCircleError: {
      backgroundColor: colors.error,
    },
    stepCircleText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    stepCircleTextLight: {
      color: colors.white,
    },
    skipText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    intro: {
      fontSize: 14,
      color: colors.textSecondary,
      paddingHorizontal: 20,
      marginTop: 12,
      marginBottom: 4,
    },
    successText: {
      color: colors.success,
      fontWeight: '700',
      fontSize: 14,
      paddingHorizontal: 20,
      marginBottom: 4,
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
    retrySaveContainer: {
      position: 'absolute',
      bottom: 100,
      left: 20,
      right: 20,
    },
  });
}

