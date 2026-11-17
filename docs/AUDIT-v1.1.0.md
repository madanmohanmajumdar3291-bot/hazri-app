# Hazri v1.0.2 technical and security audit

Audited 2026-11-16 against `main` at 2f9c5ed (the v1.0.2 source) and the live Supabase project `ckmqbhrmcdeksauejnlp`.
Method: full read of the auth, attendance, sync, face, location and navigation code; live inspection of RLS policies, functions, triggers, constraints, storage buckets, cron jobs and Supabase security advisors; `npm audit` on the installed dependency tree. No Android device or emulator was available, so nothing here was observed on a phone.

## 1. What the app actually is

| Area | Finding |
|---|---|
| Framework | React Native 0.81.5 on Expo SDK 54 (managed workflow, prebuild via EAS). JavaScript, no TypeScript in the app. No native Android code is checked in. |
| Backend | Supabase: Postgres with RLS, Auth (email + password), Storage, 13 Deno Edge Functions, one pg_cron job. |
| Identity | Supabase Auth session (JWT + refresh token). Roles live in `public.users.role`: owner, manager, partner_edit, partner_view. Employees have no login. |
| Local storage | Session in AsyncStorage (plain file). SQLite `facemark.db`: offline attendance queue and a cache of every employee's face embeddings. |
| Face | ML Kit face detection, then a FaceNet TFLite model (128-d) via react-native-fast-tflite, with a 25-d landmark heuristic fallback. Optional AWS Rekognition via `index-face` / `search-face` (AWS keys are not configured, so it is never used). |
| GPS | expo-location for check-in position; background location task for remote employees; client-side geofence against `sites`. |
| OTA | expo-updates, runtimeVersion policy `appVersion` (currently 1.0.0), channel `preview`. |
| Live data | 3 companies, 3 users, 1 employee, 51 attendance rows (49 are auto-absent rows). Effectively pre-launch, which makes now the cheapest time to fix the data model. |

## 2. Critical

| # | Issue | Evidence | Impact |
|---|---|---|---|
| C1 | **Any signed-in user can change their own role, company and permissions.** The `users` UPDATE policy is `id = auth.uid() OR (same company AND owner/partner_edit)` with no column restriction. | `pg_policies` on `public.users` | A manager or read-only partner can make themselves `owner`, grant themselves every permission, or move into another company by writing its UUID into `company_id`. Full privilege escalation and cross-tenant access, using only the anon key and their own login. |
| C2 | **`users` allows self-insert with any company and role.** Policy "self insert on signup" only checks `id = auth.uid()`. | `pg_policies` | Anyone who can create an auth account (public signup is on by default in Supabase) can insert a `users` row with `role = 'owner'` and any `company_id`, then read that company's employees, attendance and face data. The app never inserts into `users` from the client (signup goes through `signup-owner`), so the policy is unused. |
| C3 | **Kiosk Mode and Home bypass the Menu lock.** Kiosk's "Back to Menu" does `navigation.replace('Menu')`, Menu opens Kiosk with `navigate` (so Android Back returns to Menu), and Home's gear icon opens Settings directly. | `KioskScreen.js:79,142`, `MenuScreen.js:145`, `HomeScreen.js:161` | Anyone standing at a shared kiosk phone reaches the owner's Menu, Settings, payroll and employee records without face or password. |
| C4 | **Offline sync can create duplicate attendance rows.** `syncPendingAttendance()` has no lock and is fired from every scan, every network change and every scanner mount, so two runs read the same `pending` row and both insert it. There is no unique key on `attendance` and no idempotency key, and a timed-out insert that actually succeeded is re-inserted on the next run. | `syncService.js`, `attendanceService.js:recordAttendance`, live constraints (only a PK) | Double check-ins, wrong hours and wrong payroll. Also: an offline scan from day D that syncs after midnight IST collides with the cron's auto-absent row for day D, leaving both "absent" and "present" for the same day. |

## 3. High

| # | Issue | Evidence | Impact |
|---|---|---|---|
| H1 | Logout leaves every employee's face embeddings in SQLite, and the cache has no `company_id`. The next account to sign in on that phone matches against the previous company's faces whenever it is offline. | `db.js`, `attendanceService.getCompanyEmployees`, `authService.logoutOwner` | Biometric data of company A exposed to company B; wrong-person attendance offline. |
| H2 | Session tokens are stored in AsyncStorage (unencrypted app files). | `supabase.js` | Refresh token readable from a rooted phone or an adb backup. Should be Keystore-backed. |
| H3 | No `AppState` handling for token refresh (Supabase's documented requirement for React Native). | `supabase.js`, no `AppState` anywhere | After the app sits in the background past JWT expiry, requests fail until a refresh happens to fire. |
| H4 | Background location task keeps the tracked employee in module memory. When Android restarts the JS process for the task, both ids are `null` and every ping is dropped. | `fieldTrackingService.js:14-22` | Field tracking silently stops after the app is backgrounded or killed, which is exactly when it is needed. |
| H5 | Attendance times are taken from the phone clock and trusted as-is. No server receipt time, no sanity check. | `attendanceService.js`, no triggers on `attendance` | Changing the phone clock forges check-in time. |
| H6 | Geofence result is computed on the phone and written as `is_outside_geofence`; the server never checks it. | `attendanceService.resolveGeofenceForCompany`, no trigger | A modified client or spoofed result marks an off-site scan as on-site. |
| H7 | No audit trail for attendance edits. Any company account, including read-only `partner_view`, can update attendance rows, and nothing records old values. | `pg_policies` on `attendance`, no triggers | Corrections cannot be reviewed; tampering is invisible. |
| H8 | `visit-photos` bucket: any signed-in user of any company can read and upload every object. | storage policies | Cross-company photo access. (No current code path uploads visit photos, so impact is latent.) |
| H9 | `company-logos` bucket: any signed-in user can overwrite any company's logo. | storage policies | Cross-tenant defacement. |
| H10 | Phone login rate limiting depends on Supabase Auth's per-IP limit, but every phone login comes from the Edge Function's IP. One attacker can throttle all users, and there is no per-account lockout. | `phone-login/index.ts` | Credential stuffing and account-wide lockouts. |
| H11 | No React error boundary and no global JS error handler. | none present | Any render error shows a blank white screen with no recovery and no report. |

## 4. Medium

| # | Issue |
|---|---|
| M1 | Sync retries permanent errors (RLS 42501, FK 23503, bad data 22xxx) forever, with no backoff, attempt count or visible failure state. Conflicting duplicates are marked `dropped`, discarding the dropped row's checkout. |
| M2 | `getSession()` has no `.catch`; a storage or parse failure leaves the app on the splash screen forever. |
| M3 | Menu-unlock password lockout lives in component state and resets when the screen remounts. |
| M4 | `signup-owner` is unauthenticated with no validation of email format or password length, and no throttling. |
| M5 | `mark_daily_absences` marks employees absent on weekly offs, approved leave and days before they were created. |
| M6 | Late and absent notifications are saved as preferences but never sent (no sender exists). |
| M7 | Signup screen and camera permission text still say "FaceMark". |
| M8 | `RECORD_AUDIO` permission is requested but the app never records audio. |
| M9 | One owner account has a 25-d fallback face template while live scans now produce 128-d FaceNet vectors; `cosineSimilarity` returns 0 on length mismatch, so that owner can only unlock with the password until they re-register. |
| M10 | Menu unlock and attendance have no liveness check (removed deliberately for speed, documented in code). A printed photo of a registered person can match. |
| M11 | `get_email_for_phone` is still executable by anon (pending migration 20261104b after v1.0.2 rollout). `current_company_id()` / `current_role()` are anon-executable (return null, low risk). |
| M12 | `facenet_debug_log` accepts unlimited inserts from any signed-in user. |
| M13 | `app.json` version is 1.0.0 while releases are 1.0.2; `PRIVACY.md` still has a contact placeholder. |
| M14 | GitHub workflow interpolates `inputs.*` directly into shell (`publish-apk-release.yml`). Only repo writers can trigger it. |

## 5. Dependencies (`npm audit --omit=dev`)

31 advisories: 8 high, 20 moderate, 3 low, 0 critical. Assessed:

- `xlsx` 0.18.5 (prototype pollution, ReDoS): only used to *write* reports, never to parse untrusted files. Low practical risk; no fixed version on npm.
- `@react-navigation/native` 6.x via `query-string` / `decode-uri-component` (DoS on malformed deep links): local DoS only. Fix needs React Navigation 7, a breaking upgrade, deferred.
- `image-size`, `postcss`: build-time tooling, not shipped in the APK.
- `node-fetch` via `face-api.js`: web-only path.
- No dependency is deprecated to the point of breaking the build; Expo SDK 54 is current.

## 6. Performance notes

- Scanner captures a photo every 700 ms and idles after ~4 s with no face (already tuned). Picture size is minimised per device.
- `getCompanyEmployees` writes every employee row to SQLite one statement at a time on each roster load; fine at current scale, should be a single transaction at a few hundred employees.
- `getShiftForEmployee` makes up to two network calls per checkout; acceptable.
- No main-thread hot spots found beyond embedding generation, which runs in native ML Kit / TFLite.

## 7. What is not a problem

- Edge functions that create employees, managers and partners re-check the caller's role and company server-side and validate cross-tenant foreign keys.
- `employee-photos` bucket is private and company-scoped (fixed in v1.0.2).
- No service-role key, AWS key or Google client secret is in the app or the repo.
- Payroll and shifts policies are correctly role-restricted.
- All traffic is HTTPS to `*.supabase.co`; Android blocks cleartext by default.

## 8. Fix order

1. C1, C2 (database, needs approval to apply), C3 (app).
2. C4 with H5, H6, H7 in one attendance migration plus client sync rewrite.
3. H1 to H4, H11 in the app.
4. H8 to H10, M-items as listed in the release notes.
