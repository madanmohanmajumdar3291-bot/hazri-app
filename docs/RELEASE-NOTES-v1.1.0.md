# Hazri 1.1.0: release notes

Security and reliability release. No screens were redesigned and no features were removed.
Requires the database migrations `supabase/migrations/20261116_v110_hardening.sql` and `20261117_v110_followup.sql`, and redeploying the `phone-login` and `signup-owner` edge functions.

## For owners (plain language)

- The Menu, Settings and Add Employee can no longer be opened from the kiosk or the Home scanner without your face or password.
- Attendance scanned offline now uploads exactly once, even if the phone loses signal mid-upload or two phones scan the same person.
- A scan saved offline before midnight no longer shows up as "absent" for that day.
- Field-staff location tracking keeps working after the app is closed or in the background.
- Your login is now stored encrypted on the phone.
- Wrong-password lockout on the menu lock now holds even if you leave the screen.
- If the app ever hits an unexpected error, it shows a restart screen instead of going blank, and the error is reported (without personal data).
- The app no longer asks for microphone permission.
- Sign-up screen now says Hazri.

## Changes by area

### Database (migration 20261116_v110_hardening.sql)
| Change | Fixes |
|---|---|
| Trigger `guard_users_update`: users can no longer change their own role, company, email or permissions; only the owner/Admin of the same company can change another account's permissions. | C1 |
| Dropped policy "self insert on signup". Accounts are created only by edge functions. | C2 |
| Unique `(employee_id, date)` on attendance; new columns `client_txn_id` (unique), `server_received_at`, `clock_suspect`, `updated_at`. | C4, H5 |
| `sync_attendance(p jsonb)`: idempotent merge used by offline sync (earliest check-in, latest check-out; replaces an auto-absence; recomputes hours and late flag server-side). Runs with the caller's permissions, so company isolation still applies. | C4 |
| Trigger `attendance_before_write`: stamps server receipt time, flags times more than 5 minutes in the future, rejects check-out before check-in, recomputes the geofence from coordinates. | H5, H6 |
| Table `attendance_audit` + trigger: every edit and delete is recorded with old and new values and who made it. Readable by owner, Admin and managers. | H7 |
| Storage: visit photos and company logos are limited to the caller's own company folder. | H8, H9 |
| Table `login_throttle` (service role only). | H10 |
| Table `client_errors` (insert-only) for crash reports; sender is stamped server-side. | H11 |
| `mark_daily_absences`: skips the shift's weekly off, marks approved leave as leave, skips days before the employee was added. | M5 |
| `current_company_id()` / `current_role()` no longer callable anonymously. | M11 |
| Follow-up `20261117_v110_followup.sql`: trigger functions are no longer callable over the REST API; `haversine_m` has a fixed search_path and is not callable anonymously (Supabase security advisor). | Advisor |

### Edge functions
- `phone-login`: per-number lockout (5 failures / 15 min) and per-IP limit (30 / 15 min). Unknown numbers count too, so the lock reveals nothing.
- `signup-owner`: validates name, company, email, 10-digit mobile, password 8 to 72 characters; at most 5 sign-ups per IP per hour; no internal error text returned.

### App
| File | Change |
|---|---|
| `KioskScreen.js`, `MenuScreen.js`, `HomeScreen.js` | Leaving the kiosk by button, Back or swipe goes to MenuUnlock. Menu opens the kiosk with a stack reset. Home's settings and add-employee go through MenuUnlock. |
| `syncService.js` | Single-flight sync; calls `sync_attendance` with a UUID transaction id; exponential backoff (30 s to 1 h); permanent errors parked as `failed` after 3 tries, kept on the phone and re-queued on next sign-in; no sync while signed out; v1.0.x `dropped` rows are re-queued. |
| `db.js` | New columns for txn id, attempts, last error, next attempt, cache company. |
| `attendanceService.js` | Face cache stored per company in one transaction and read filtered by company; offline check-ins get a transaction id. |
| `authService.js` | Logout clears cached face templates (keeps queued attendance); local sign-out works offline. |
| `secureStorage.js`, `supabase.js`, `http.js` | Session in Keystore-backed SecureStore (chunked, migrates the old session automatically); 60 s request timeout; token refresh paused/resumed with app state. |
| `AuthContext.js` | Splash can no longer hang on a storage error; account reload deferred out of the auth lock; no refetch on every token refresh. |
| `fieldTrackingService.js` | Tracked employee persisted so the background task works after the app process restarts. |
| `MenuUnlockScreen.js`, `utils/unlockLockout.js` | Password lockout persisted per account. |
| `ErrorBoundary.js`, `errorReporting.js`, `App.js` | Error screen with restart; global JS error and unhandled-rejection reporting with scrubbing of tokens, emails, phone numbers and face data. |
| `app.json`, `package.json` | Version 1.1.0; RECORD_AUDIO blocked; "FaceMark" text replaced. |
| `.github/workflows/publish-apk-release.yml` | Inputs passed via env (no shell injection); optional notes input. |

## Test results (2026-11-16)

| Suite | Result | What it covers |
|---|---|---|
| `npm test` (Jest, 8 suites) | **46 / 46 passed** | Offline sync against a real SQLite engine (dedupe, idempotency, backoff, permanent failures, signed-out, mid-flight checkout, legacy rows), face matching rules, offline check-in/out, per-company cache, secure storage (chunking, migration, torn writes, fallback), crash-report scrubbing and rate limits, password lockout, kiosk navigation lock, login throttle, logout cache wipe, request timeout. |
| `npm run test:db` (Postgres 16) | **38 / 38 passed** | Privilege escalation blocked, no client user inserts, cross-company reads and writes blocked, sync idempotency and merge, auto-absence replacement, late flag, clock and geofence checks, audit trail, no deletes, absence rules, storage isolation, crash-report table, trigger functions not callable over the API. |
| `npx expo export --platform android` | **Bundles cleanly** (Hermes bytecode, 7.2 MB) | Whole app compiles. |
| Edge function TypeScript | Parses cleanly | Not executed under Deno (Deno could not be installed in this environment). |

**Not yet tested:** anything on a real phone. No APK has been built or installed. The database tests ran on a local Postgres built from `schema.sql`, not on the production project.

## Upgrade order

1. Apply the migration (data was backed up first). Done 2026-11-17. Then apply the follow-up migration.
2. Deploy `phone-login` and `signup-owner`. Done 2026-11-17.
3. Build the v1.1.0 APK on EAS (`preview` profile), install on a test phone, run the checklist below.
4. Publish the APK as release v1.1.0 (v1.0.2 stays untouched), then point `app_releases` at it.

Because `runtimeVersion` follows the app version, OTA updates published for 1.1.0 reach only 1.1.0 installs; 1.0.x phones need the new APK.

## Device test checklist (before publishing)

- [ ] Fresh install, sign up, sign in by email and by phone, sign out, sign in again.
- [ ] Upgrade over v1.0.2: still signed in afterwards (session migration).
- [ ] Kiosk: Back to Menu, Android Back and swipe all show the unlock screen.
- [ ] Home gear icon and Add Employee ask for face/password.
- [ ] Airplane mode: scan in, scan out, kill the app, reopen, turn network on: one row on the server with both times.
- [ ] Two phones offline scan the same person, then both go online: one row.
- [ ] Remote employee: check in, lock the phone for 15 minutes, check the live map for pings.
- [ ] Wrong password 3 times on the menu lock, leave and return: still locked.
- [ ] Camera and location permission denied, then granted from settings.
- [ ] Android 10, 13 and 15 if available; small (5") and large (6.7") screens.

## Known issues (not fixed in 1.1.0)

| Issue | Why not now |
|---|---|
| No liveness check on attendance or menu unlock; a photo of a registered person can match. | Was removed earlier for speed. A reliable check needs active challenges or depth hardware and device testing. Password fallback remains the menu-unlock backstop. |
| Face matching is on the phone; the server cannot verify identity. AWS Rekognition support exists but AWS keys are not configured. | Needs an AWS account and a cost decision. |
| Face templates are cached unencrypted in SQLite on the phone (now per company and wiped on logout). | SQLCipher needs a native rebuild and a migration of existing databases; should be done with device testing. |
| Late/absent notifications are saved as settings but never sent. | No sending service exists yet (needs push setup or SMS/WhatsApp provider). |
| WhatsApp alerts for crashes and unsyncable attendance (`error-alerts` function, 15-minute cron) are deployed but send nothing until the CallMeBot key is added (`20261117b_error_alerts.sql`). CallMeBot is a free third-party relay, not the official WhatsApp Business API. | Needs your CallMeBot key. |
| One owner account still has an old 25-point face template that no longer matches; that owner must re-register their face. | Needs the person. |
| v1.0.x phones keep offline duplicates queued (rejected by the new unique key) until updated. | Expected; data is not lost. |
| `get_email_for_phone` still callable anonymously. | Old v1.0.0/1.0.1 phones still use it; revoke with migration 20261104b once they are gone. |
| `xlsx` and React Navigation 6 have open advisories. | Low practical impact (write-only use; local deep-link DoS). React Navigation 7 is a breaking upgrade. |
| Leaked-password protection is off in Supabase Auth. | Dashboard setting (Pro plan feature); cannot be set from here. |
| `PRIVACY.md` contact email placeholder. | Needs your contact address. |
| Timezone for the server-side late flag is Asia/Kolkata. | No per-company timezone field exists yet. |
