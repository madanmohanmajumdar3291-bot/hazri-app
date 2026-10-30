import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDriveConnected } from './googleDriveService';
import { backUpCompanyToDrive } from './companyBackupService';

const TASK_NAME = 'hazri-google-drive-backup';
const COMPANY_ID_KEY = 'backup_company_id';

// Task executors run outside the React tree (no navigation, no auth
// context) — the company to back up has to be persisted separately so this
// still knows what to do when the OS wakes the app for it.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const connected = await isDriveConnected();
    const companyId = await AsyncStorage.getItem(COMPANY_ID_KEY);
    if (!connected || !companyId) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await backUpCompanyToDrive(companyId);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (_error) {
    // A failed background backup just tries again next cycle — nothing
    // user-visible to fail in the background, and the next manual "Back up
    // now" or scheduled run will pick it up.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Called once after connecting Google Drive successfully (and again on app
// start if still connected) so the daily task always has a fresh companyId
// even if the signed-in account changes.
export async function registerDailyBackup(companyId) {
  await AsyncStorage.setItem(COMPANY_ID_KEY, companyId);
  // Minutes; the OS treats this as a minimum, not a guarantee — actual
  // runs may be far less frequent, especially on iOS.
  await BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: 24 * 60 });
}

export async function unregisterDailyBackup() {
  await AsyncStorage.removeItem(COMPANY_ID_KEY);
  await BackgroundTask.unregisterTaskAsync(TASK_NAME).catch(() => {});
}
