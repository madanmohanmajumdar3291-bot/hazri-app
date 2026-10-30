import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useForm, Controller } from 'react-hook-form';
import Toast from 'react-native-toast-message';
import Input from '../../components/Input';
import Button from '../../components/Button';
import CameraCapture from '../../components/CameraCapture';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { validationRules } from '../../utils/validation';
import { generateEmbedding, findDuplicateFaceOwner, withTimeout } from '../../services/faceService';
import { averageEmbeddings } from '../../utils/faceUtils';
import { createEmployee, saveEmployeeFace } from '../../services/employeeService';
import { getShifts, assignShiftToEmployee } from '../../services/shiftService';
import { getCompanySites } from '../../services/locationService';
import { getCompanyDepartments } from '../../services/departmentService';

const ID_PROOF_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'voter_id', label: 'Voter ID' },
  { value: 'driving_license', label: 'Driving License' },
];

const FACE_STEPS = [
  { label: 'Step 1', instruction: 'Ask them to look straight at the camera' },
  { label: 'Step 2', instruction: 'Ask them to turn their head slightly left' },
  { label: 'Step 3', instruction: 'Ask them to turn their head slightly right' },
];

export default function AddEmployeeScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { userData } = useAuth();
  const [stage, setStage] = useState('form'); // form | face | success | skipped-warning
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdEmployee, setCreatedEmployee] = useState(null);
  const [faceStepIndex, setFaceStepIndex] = useState(0);
  const [embeddings, setEmbeddings] = useState([]);
  const [frontPhotoUri, setFrontPhotoUri] = useState(null);
  const [faceProcessing, setFaceProcessing] = useState(false);
  const [faceStatus, setFaceStatus] = useState('idle');
  const [faceError, setFaceError] = useState('');
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [sites, setSites] = useState([]);
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    if (!userData?.company_id) return;
    getShifts(userData.company_id).then(setShifts).catch(() => {});
    getCompanySites(userData.company_id).then(setSites).catch(() => {});
    getCompanyDepartments(userData.company_id).then(setDepartments).catch(() => {});
  }, [userData?.company_id]);

  const { control, handleSubmit, watch, formState: { errors } } = useForm({
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      role: 'employee',
      workMode: 'office',
      monthlySalary: '',
      overtimeRate: '',
      idProofType: '',
      idProofNumber: '',
      shiftId: null,
      siteId: null,
      departmentId: null,
    },
  });
  const role = watch('role');
  const idProofType = watch('idProofType');

  async function onSubmitForm(values) {
    setFormError('');
    setSubmitting(true);
    try {
      const employee = await createEmployee({
        name: values.fullName,
        phone: values.phone,
        email: values.email,
        role: values.role,
        work_mode: values.workMode,
        monthly_salary: values.monthlySalary ? Number(values.monthlySalary) : null,
        overtime_rate: values.overtimeRate ? Number(values.overtimeRate) : null,
        id_proof_type: values.idProofType || null,
        id_proof_number: values.idProofType ? values.idProofNumber : null,
        site_id: values.siteId || null,
        department_id: values.departmentId || null,
      });
      if (values.shiftId) {
        await assignShiftToEmployee(employee.id, values.shiftId).catch(() => {});
      }
      setCreatedEmployee(employee);
      setStage('face');
    } catch (error) {
      if (error.message === 'FREE_LIMIT_REACHED') {
        setFormError("You've reached the 20 employee free limit. Upgrade to add more.");
      } else {
        setFormError(error.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFaceCapture(uri) {
    setFaceProcessing(true);
    setFaceError('');
    let result;
    try {
      result = await withTimeout(generateEmbedding(uri), 8000);
    } catch (timeoutError) {
      result = { success: false, error: timeoutError.message };
    }

    if (!result.success) {
      setFaceProcessing(false);
      setFaceStatus('error');
      setFaceError(result.error);
      return;
    }

    setFaceStatus('detected');
    const nextEmbeddings = [...embeddings, result.embedding];
    setEmbeddings(nextEmbeddings);
    // Step 0 is "look straight at the camera" — the one usable ID photo out
    // of the three capture angles.
    if (faceStepIndex === 0) setFrontPhotoUri(uri);

    if (faceStepIndex < FACE_STEPS.length - 1) {
      setFaceStepIndex(faceStepIndex + 1);
      setFaceStatus('idle');
      // Only safe to let CameraCapture's live-scan loop resume once we've
      // actually moved to the next step — clearing this any earlier let the
      // camera try to auto-capture again while this screen was mid-transition.
      setFaceProcessing(false);
    } else {
      // Deliberately leave faceProcessing=true for the rest of this function
      // (camera's own live-scan loop stays paused) — this is the final step,
      // about to save and unmount the camera into the success screen, and a
      // stray capture firing during that async gap right before unmount is
      // what was causing the blank-screen flash between "face captured" and
      // "added successfully" showing up.
      await finishFaceRegistration(nextEmbeddings);
    }
  }

  async function finishFaceRegistration(allEmbeddings, skipDuplicateCheck = false) {
    const masterEmbedding = averageEmbeddings(allEmbeddings);

    // The exact same face must not be registerable under a second employee
    // record — without this check, creating a new employee and pointing the
    // camera at someone already registered silently overwrote that person's
    // identity onto the new id instead of refusing.
    if (createdEmployee?.company_id && !skipDuplicateCheck) {
      let duplicateName = null;
      try {
        duplicateName = await findDuplicateFaceOwner(createdEmployee.company_id, masterEmbedding, {
          excludeEmployeeId: createdEmployee.id,
        });
      } catch (_error) {
        // If the duplicate check itself fails (e.g. offline), don't block
        // registration on it — fall through and save normally.
      }
      if (duplicateName) {
        setFaceError(`This face is already registered to ${duplicateName}. Each person can only be registered once.`);
        setDuplicateBlocked(true);
        setFaceProcessing(false);
        return;
      }
    }

    setDuplicateBlocked(false);
    try {
      await saveEmployeeFace(createdEmployee.id, masterEmbedding, frontPhotoUri);
      Toast.show({ type: 'success', text1: 'Face registered successfully' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Could not save face', text2: error.message });
    }
    setStage('success');
  }

  function handleSkipFace() {
    Toast.show({
      type: 'info',
      text1: "Face not registered",
      text2: "This employee won't be able to use face check-in until their face is registered.",
    });
    setStage('success');
  }

  if (stage === 'success') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successIcon}>🎉</Text>
        <Text style={styles.successTitle}>{createdEmployee?.name} has been added successfully!</Text>
        {createdEmployee?.employee_code ? (
          <View style={styles.employeeIdBadge}>
            <Text style={styles.employeeIdLabel}>Employee ID</Text>
            <Text style={styles.employeeIdValue}>{createdEmployee.employee_code}</Text>
          </View>
        ) : null}
        <View style={styles.successButtons}>
          <Button
            title="Add Another Employee"
            variant="outline"
            onPress={() => {
              setStage('form');
              setCreatedEmployee(null);
              setFaceStepIndex(0);
              setEmbeddings([]);
              setFaceStatus('idle');
              setFaceError('');
              setDuplicateBlocked(false);
            }}
          />
          <View style={{ height: 12 }} />
          <Button title="Done" onPress={() => navigation.navigate('EmployeesList')} />
        </View>
      </View>
    );
  }

  if (stage === 'face') {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
          <View style={styles.stepsRow}>
            {FACE_STEPS.map((step, index) => (
              <Text
                key={step.label}
                style={[styles.stepLabel, index === faceStepIndex && styles.activeStepLabel]}
              >
                {step.label}
              </Text>
            ))}
          </View>
          <TouchableOpacity onPress={handleSkipFace}>
            <Text style={styles.skipText}>Skip Face</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.intro}>Register {createdEmployee?.name}'s Face</Text>
        {faceError ? <Text style={styles.errorText}>{faceError}</Text> : null}

        <View style={styles.cameraWrapper}>
          <CameraCapture
            onCapture={handleFaceCapture}
            onCancel={() => setStage('success')}
            instruction={FACE_STEPS[faceStepIndex].instruction}
            processing={faceProcessing}
            status={faceStatus}
            defaultFacing="back"
          />
        </View>

        {duplicateBlocked && (
          <View style={styles.duplicateButtons}>
            <Button title="Save Anyway" onPress={() => finishFaceRegistration(embeddings, true)} />
            <View style={{ height: 10 }} />
            <Button
              title="Retake Photos"
              variant="outline"
              onPress={() => {
                setFaceStepIndex(0);
                setEmbeddings([]);
                setFaceStatus('idle');
                setFaceError('');
                setDuplicateBlocked(false);
                setFaceProcessing(false);
              }}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={[styles.formContainer, { paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add Employee</Text>
        <Text style={styles.subtitle}>Step 1 of 2 — Employee Details</Text>

        <Controller
          control={control}
          name="fullName"
          rules={validationRules.fullName}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Full Name"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.fullName?.message}
              autoCapitalize="words"
              placeholder="Employee's full name"
            />
          )}
        />

        <Controller
          control={control}
          name="email"
          rules={{ pattern: validationRules.email.pattern }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Email Address (optional)"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.email?.message}
              keyboardType="email-address"
              placeholder="employee@example.com"
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          rules={{ pattern: validationRules.phone.pattern }}
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Phone Number (optional)"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              error={errors.phone?.message}
              keyboardType="number-pad"
              placeholder="10-digit mobile number"
            />
          )}
        />

        <Text style={styles.label}>Role</Text>
        <Controller
          control={control}
          name="role"
          render={({ field: { onChange, value } }) => (
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleCard, value === 'employee' && styles.roleCardSelected]}
                onPress={() => onChange('employee')}
              >
                <Text style={[styles.roleCardText, value === 'employee' && styles.roleCardTextSelected]}>
                  {value === 'employee' ? '✓ ' : ''}Employee
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleCard, value === 'manager' && styles.roleCardSelected]}
                onPress={() => onChange('manager')}
              >
                <Text style={[styles.roleCardText, value === 'manager' && styles.roleCardTextSelected]}>
                  {value === 'manager' ? '✓ ' : ''}User
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />

        <Text style={styles.label}>ID Proof (optional)</Text>
        <Controller
          control={control}
          name="idProofType"
          render={({ field: { onChange, value } }) => (
            <View style={styles.idProofRow}>
              {ID_PROOF_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.value}
                  style={[styles.idProofCard, value === type.value && styles.roleCardSelected]}
                  onPress={() => onChange(value === type.value ? '' : type.value)}
                >
                  <Text
                    style={[styles.idProofCardText, value === type.value && styles.roleCardTextSelected]}
                    numberOfLines={2}
                  >
                    {value === type.value ? '✓ ' : ''}{type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
        {idProofType ? (
          <Controller
            control={control}
            name="idProofNumber"
            rules={{ required: 'Enter the ID number, or unselect the ID type above' }}
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label={`${ID_PROOF_TYPES.find((t) => t.value === idProofType)?.label} Number`}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.idProofNumber?.message}
                autoCapitalize="characters"
                placeholder="Enter ID number"
              />
            )}
          />
        ) : null}

        <Text style={styles.label}>Work Mode</Text>
        <Controller
          control={control}
          name="workMode"
          render={({ field: { onChange, value } }) => (
            <View style={styles.roleRow}>
              <TouchableOpacity
                style={[styles.roleCard, value === 'office' && styles.roleCardSelected]}
                onPress={() => onChange('office')}
              >
                <Text style={[styles.roleCardText, value === 'office' && styles.roleCardTextSelected]}>
                  {value === 'office' ? '✓ ' : ''}Office
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleCard, value === 'remote' && styles.roleCardSelected]}
                onPress={() => onChange('remote')}
              >
                <Text style={[styles.roleCardText, value === 'remote' && styles.roleCardTextSelected]}>
                  {value === 'remote' ? '✓ ' : ''}Remote / Field
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />
        <Text style={styles.hint}>
          Office employees must check in from an approved site. Remote/field staff skip site restrictions but are
          still tracked on the live map.
        </Text>

        {shifts.length > 0 && (
          <>
            <Text style={styles.label}>Shift (optional)</Text>
            <Controller
              control={control}
              name="shiftId"
              render={({ field: { onChange, value } }) => (
                <View style={styles.shiftChipRow}>
                  <TouchableOpacity
                    style={[styles.shiftChip, !value && styles.roleCardSelected]}
                    onPress={() => onChange(null)}
                  >
                    <Text style={[styles.idProofCardText, !value && styles.roleCardTextSelected]}>
                      {!value ? '✓ ' : ''}No Shift
                    </Text>
                  </TouchableOpacity>
                  {shifts.map((shift) => (
                    <TouchableOpacity
                      key={shift.id}
                      style={[styles.shiftChip, value === shift.id && styles.roleCardSelected]}
                      onPress={() => onChange(shift.id)}
                    >
                      <Text style={[styles.idProofCardText, value === shift.id && styles.roleCardTextSelected]}>
                        {value === shift.id ? '✓ ' : ''}{shift.shift_name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            />
          </>
        )}

        {sites.length > 0 && (
          <>
            <Text style={styles.label}>Branch (optional)</Text>
            <Controller
              control={control}
              name="siteId"
              render={({ field: { onChange, value } }) => (
                <View style={styles.shiftChipRow}>
                  <TouchableOpacity
                    style={[styles.shiftChip, !value && styles.roleCardSelected]}
                    onPress={() => onChange(null)}
                  >
                    <Text style={[styles.idProofCardText, !value && styles.roleCardTextSelected]}>
                      {!value ? '✓ ' : ''}No Branch
                    </Text>
                  </TouchableOpacity>
                  {sites.map((site) => (
                    <TouchableOpacity
                      key={site.id}
                      style={[styles.shiftChip, value === site.id && styles.roleCardSelected]}
                      onPress={() => onChange(site.id)}
                    >
                      <Text style={[styles.idProofCardText, value === site.id && styles.roleCardTextSelected]}>
                        {value === site.id ? '✓ ' : ''}{site.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            />
          </>
        )}

        {departments.length > 0 && (
          <>
            <Text style={styles.label}>Department (optional)</Text>
            <Controller
              control={control}
              name="departmentId"
              render={({ field: { onChange, value } }) => (
                <View style={styles.shiftChipRow}>
                  <TouchableOpacity
                    style={[styles.shiftChip, !value && styles.roleCardSelected]}
                    onPress={() => onChange(null)}
                  >
                    <Text style={[styles.idProofCardText, !value && styles.roleCardTextSelected]}>
                      {!value ? '✓ ' : ''}No Department
                    </Text>
                  </TouchableOpacity>
                  {departments.map((department) => (
                    <TouchableOpacity
                      key={department.id}
                      style={[styles.shiftChip, value === department.id && styles.roleCardSelected]}
                      onPress={() => onChange(department.id)}
                    >
                      <Text style={[styles.idProofCardText, value === department.id && styles.roleCardTextSelected]}>
                        {value === department.id ? '✓ ' : ''}{department.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            />
          </>
        )}

        <Controller
          control={control}
          name="monthlySalary"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Monthly Salary (optional)"
              value={value}
              onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
              onBlur={onBlur}
              keyboardType="decimal-pad"
              placeholder="e.g. 15000"
            />
          )}
        />

        <Controller
          control={control}
          name="overtimeRate"
          render={({ field: { onChange, onBlur, value } }) => (
            <Input
              label="Overtime Rate per Hour (optional)"
              value={value}
              onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))}
              onBlur={onBlur}
              keyboardType="decimal-pad"
              placeholder="e.g. 100"
            />
          )}
        />

        {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

        <Button title="Next" onPress={handleSubmit(onSubmitForm)} loading={submitting} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    formContainer: {
      flexGrow: 1,
      padding: 24,
    },
    backText: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 12,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 20,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    roleRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 14,
    },
    roleCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: colors.card,
    },
    roleCardSelected: {
      borderColor: colors.accent,
      borderWidth: 2,
    },
    roleCardText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    roleCardTextSelected: {
      color: colors.accent,
    },
    idProofRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    shiftChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 14,
    },
    shiftChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.card,
    },
    idProofCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    idProofCardText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    errorText: {
      color: colors.error,
      fontSize: 13,
      marginBottom: 8,
      textAlign: 'center',
    },
    hint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 16,
      marginTop: -6,
    },
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
      marginBottom: 8,
    },
    cameraWrapper: {
      flex: 1,
    },
    duplicateButtons: {
      padding: 20,
    },
    successContainer: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    successIcon: {
      fontSize: 56,
      marginBottom: 16,
    },
    successTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: 16,
    },
    employeeIdBadge: {
      backgroundColor: colors.accentSoft,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 20,
      alignItems: 'center',
      marginBottom: 32,
    },
    employeeIdLabel: {
      fontSize: 11,
      color: colors.accent,
      fontWeight: '600',
    },
    employeeIdValue: {
      fontSize: 18,
      color: colors.accent,
      fontWeight: '800',
      letterSpacing: 1,
    },
    successButtons: {
      width: '100%',
    },
  });
}

