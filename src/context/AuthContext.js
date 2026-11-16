import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '../services/supabase';
import { fetchUserDoc, saveFaceEmbedding as saveFaceEmbeddingRequest } from '../services/authService';
import { requeueFailedForCompany } from '../services/syncService';
import { reportError } from '../services/errorReporting';

// Supabase's reset-password link redirects back to our app URL with the
// recovery tokens in the URL's hash fragment (#access_token=...&type=recovery)
// — the same format `detectSessionInUrl` already parses on web. On native
// there's no browser to auto-parse that, so the incoming deep link has to be
// handled by hand: pull the tokens out and hand them to supabase-js directly.
async function handleRecoveryUrl(url) {
  if (!url) return;
  const hash = url.split('#')[1];
  if (!hash) return;
  const params = new URLSearchParams(hash);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return;
  await supabase.auth.setSession({ access_token, refresh_token });
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [pendingFaceSetup, setPendingFaceSetup] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    async function loadUser(sessionUser) {
      if (sessionUser) {
        // A flaky connection (common on older phones/weak signal) can make
        // this throw. Previously that left userData permanently null with
        // no retry and no error surfaced — every role check downstream
        // (Menu, Home, etc.) then silently falls through to "show nothing"
        // instead of a visible error. Retry once before giving up, and
        // never wipe out already-loaded userData on failure.
        let data = null;
        let fetchFailed = false;
        try {
          data = await fetchUserDoc(sessionUser.id);
        } catch (_error) {
          try {
            data = await fetchUserDoc(sessionUser.id);
          } catch (retryError) {
            fetchFailed = true;
            console.warn('Failed to load account data:', retryError?.message);
          }
        }

        // The fetch succeeded but found no row — this session's account was
        // deleted server-side (e.g. a database reset) while the phone still
        // had a valid cached login. Supabase Auth still accepts the old
        // token, so without this the app gets stuck "signed in" with no
        // account data behind it — face scanning, menu, everything breaks
        // silently. Force a real sign-out so Login is reachable again.
        if (!data && !fetchFailed) {
          await supabase.auth.signOut();
          setFirebaseUser(null);
          setUserData(null);
          setPendingFaceSetup(false);
          setInitializing(false);
          return;
        }

        setFirebaseUser(sessionUser);
        // Keep what was already loaded if this refresh failed.
        if (data || !fetchFailed) setUserData(data);
        if (data?.company_id) requeueFailedForCompany(data.company_id).catch(() => {});
      } else {
        setFirebaseUser(null);
        setUserData(null);
        setPendingFaceSetup(false);
      }
      setInitializing(false);
    }

    // A storage or parse failure here used to leave the splash screen up
    // forever (initializing never cleared). Treat it as signed out instead.
    supabase.auth
      .getSession()
      .then(({ data }) => loadUser(data?.session?.user ?? null))
      .catch((error) => {
        reportError(error, { context: { area: 'getSession' } });
        loadUser(null);
      });

    // Clicking the "reset password" email link signs the user into a
    // temporary recovery session — this event tells us to route to the
    // reset-password screen instead of straight into the app.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      // Token refreshes don't change who is signed in; re-fetching the
      // account on each one is a wasted request every hour.
      if (event === 'TOKEN_REFRESHED') return;
      // Deferred: supabase-js holds its auth lock while running this
      // callback, and loadUser makes requests that need the same lock.
      setTimeout(() => {
        loadUser(session?.user ?? null).catch((error) => {
          reportError(error, { context: { area: 'loadUser' } });
          setInitializing(false);
        });
      }, 0);
    });

    // Native (no browser) needs the incoming deep link parsed by hand —
    // setSession() below then triggers the same onAuthStateChange listener
    // above that already routes into the reset-password screen on web.
    Linking.getInitialURL().then(handleRecoveryUrl).catch(() => {});
    const urlListener = Linking.addEventListener('url', ({ url }) => {
      handleRecoveryUrl(url).catch(() => {});
    });

    return () => {
      listener.subscription.unsubscribe();
      urlListener.remove();
    };
  }, []);

  async function saveFaceEmbedding(embedding, photoUri, allEmbeddings) {
    if (!firebaseUser) return;
    const updated = await saveFaceEmbeddingRequest(firebaseUser.id, embedding, photoUri, allEmbeddings);
    setUserData(updated);
    return updated;
  }

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userData,
        setUserData,
        initializing,
        faceRegistered: Boolean(userData?.face_registered),
        saveFaceEmbedding,
        pendingFaceSetup,
        setPendingFaceSetup,
        passwordRecovery,
        setPasswordRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

