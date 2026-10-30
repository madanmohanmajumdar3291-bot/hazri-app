import { Platform } from 'react-native';
import {
  cosineSimilarity,
  SIMILARITY_THRESHOLD,
  euclideanDistance,
  EUCLIDEAN_MATCH_THRESHOLD,
  SIMILARITY_DUPLICATE_THRESHOLD,
  EUCLIDEAN_DUPLICATE_THRESHOLD,
} from '../utils/faceUtils';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Web implementation: face-api.js running directly in the browser.
// This is the path that's actually been proven fast and reliable (no native
// bridge instability, no dead packages, no custom native build required) —
// it's what `expo start --web` uses, and what most testing has happened on.
// ---------------------------------------------------------------------------
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
const DETECTOR_INPUT_SIZE = 224;
const DETECTOR_SCORE_THRESHOLD = 0.5;

let faceapi = null;
let webModelsPromise = null;

function getFaceApi() {
  // Requiring the package root resolves to its ES6 source, which pulls in a
  // separately-installed, exact-pinned old @tensorflow/tfjs-core that Metro
  // can't resolve (a broken "module" field). The prebuilt dist bundle has
  // everything self-contained — same file the standalone web demo used.
  if (!faceapi) faceapi = require('face-api.js/dist/face-api.min.js');
  return faceapi;
}

async function ensureWebModelsLoaded() {
  if (webModelsPromise) return webModelsPromise;
  const api = getFaceApi();
  webModelsPromise = (async () => {
    await api.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await api.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await api.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
  })();
  return webModelsPromise;
}

function loadRawImageElement(uri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load captured image.'));
    img.src = uri;
  });
}

// Camera photos come in at full sensor resolution (often 720p+), but face
// detection/landmark models only need a few hundred pixels of width to work
// — feeding them the full-size image wastes most of the inference time on
// pixels that don't matter. Downscaling first is the single biggest lever
// for making each scan faster, especially the liveness loop which runs on
// every tick.
async function loadImageElement(uri, maxWidth) {
  const img = await loadRawImageElement(uri);
  if (!maxWidth || img.width <= maxWidth) return img;

  const scale = maxWidth / img.width;
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return loadRawImageElement(canvas.toDataURL('image/jpeg', 0.85));
}

async function generateEmbeddingWeb(imageUri) {
  try {
    const api = getFaceApi();
    await ensureWebModelsLoaded();
    const img = await loadImageElement(imageUri, 480);

    const detectorOptions = new api.TinyFaceDetectorOptions({
      inputSize: DETECTOR_INPUT_SIZE,
      scoreThreshold: DETECTOR_SCORE_THRESHOLD,
    });

    const result = await api
      .detectSingleFace(img, detectorOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!result) {
      return {
        success: false,
        error: 'No face detected. Please look directly at the camera and ensure good lighting.',
      };
    }

    // Eye-aspect-ratio from the 68-point landmarks — the liveness signal used
    // for blink detection (a static photo's "eyes" never change value).
    const leftEAR = computeEAR(result.landmarks.getLeftEye());
    const rightEAR = computeEAR(result.landmarks.getRightEye());
    const eyeOpenness = (leftEAR + rightEAR) / 2;

    const { box } = result.detection;
    const faceBox = { left: box.x, top: box.y, width: box.width, height: box.height, imageWidth: img.width, imageHeight: img.height };
    return { success: true, embedding: Array.from(result.descriptor), eyeOpenness, faceBox };
  } catch (error) {
    return { success: false, error: 'Face processing failed. Please try again.' };
  }
}

function computeEAR(points) {
  // Standard 6-point eye-aspect-ratio (Soukupová & Čech). `points` follow
  // face-api.js's dlib-style ordering: [outer, top1, top2, inner, bottom2, bottom1].
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const vertical = dist(points[1], points[5]) + dist(points[2], points[4]);
  const horizontal = dist(points[0], points[3]);
  return horizontal === 0 ? 0 : vertical / (2 * horizontal);
}

// ---------------------------------------------------------------------------
// Liveness (blink) detection: MediaPipe FaceLandmarker.
// Our own EAR-from-68-landmarks math (face-api.js) turned out too imprecise
// to reliably catch a blink across different cameras/lighting. MediaPipe's
// face_landmarker model outputs "blendshapes" — pre-trained, calibrated
// expression scores including eyeBlinkLeft/eyeBlinkRight (0 = open, 1 =
// fully closed) — a proven signal instead of hand-rolled geometry.
// ---------------------------------------------------------------------------
const MEDIAPIPE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MEDIAPIPE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Metro's bundler chokes trying to statically transform the npm package's
// CJS build (it contains a dynamic import() Metro's transformer can't parse,
// which crashes the ENTIRE app bundle, not just this feature). Loading it as
// a real ESM module via a native <script type="module"> tag keeps it
// completely out of Metro's bundling/transform pipeline.
let mediapipeVisionPromise = null;

function loadMediapipeVisionModule() {
  if (window.__mediapipeVisionTasks) return Promise.resolve(window.__mediapipeVisionTasks);
  if (mediapipeVisionPromise) return mediapipeVisionPromise;

  mediapipeVisionPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import * as vision from '${MEDIAPIPE_ESM_URL}';
      window.__mediapipeVisionTasks = vision;
      window.dispatchEvent(new Event('mediapipe-vision-ready'));
    `;
    window.addEventListener(
      'mediapipe-vision-ready',
      () => resolve(window.__mediapipeVisionTasks),
      { once: true }
    );
    script.onerror = () => reject(new Error('Failed to load MediaPipe vision tasks.'));
    document.head.appendChild(script);
  });

  return mediapipeVisionPromise;
}

let faceLandmarkerPromise = null;

async function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await loadMediapipeVisionModule();
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL },
        outputFaceBlendshapes: true,
        runningMode: 'IMAGE',
        numFaces: 1,
      });
    })();
  }
  return faceLandmarkerPromise;
}

async function detectLivenessWeb(imageUri) {
  try {
    const landmarker = await getFaceLandmarker();
    const img = await loadImageElement(imageUri, 240);
    const result = landmarker.detect(img);

    if (!result.faceBlendshapes || result.faceBlendshapes.length === 0) {
      return { success: false };
    }

    const categories = result.faceBlendshapes[0].categories;
    const blinkLeft = categories.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
    const blinkRight = categories.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;

    // Blendshape score is "how closed", so invert it to "how open" to keep
    // the same eyeOpenness convention the rest of the app already uses.
    const eyeOpenness = 1 - (blinkLeft + blinkRight) / 2;
    return { success: true, eyeOpenness };
  } catch (_error) {
    return { success: false };
  }
}

// ---------------------------------------------------------------------------
// Native implementation: Google ML Kit via @react-native-ml-kit/face-detection.
// Only reachable in a custom dev-client build (not Expo Go) — kept here ready
// for whenever that build happens; the web path above is what's live today.
// ---------------------------------------------------------------------------
const LANDMARK_TYPES = [
  'leftEye',
  'rightEye',
  'noseBase',
  'leftEar',
  'rightEar',
  'leftCheek',
  'rightCheek',
  'mouthLeft',
  'mouthRight',
  'mouthBottom',
];

async function generateEmbeddingNative(imageUri) {
  try {
    const FaceDetection = require('@react-native-ml-kit/face-detection').default;
    const ImageManipulator = require('expo-image-manipulator');

    const resized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 480 } }],
      { format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 }
    );

    const faces = await FaceDetection.detect(resized.uri, {
      performanceMode: 'accurate',
      landmarkMode: 'all',
      classificationMode: 'all',
    });

    if (!faces || faces.length === 0) {
      return {
        success: false,
        error: 'No face detected. Please look directly at the camera and ensure good lighting.',
      };
    }
    if (faces.length > 1) {
      return {
        success: false,
        error: 'Multiple faces detected. Please ensure only one person is in the frame.',
      };
    }

    const face = faces[0];
    const { frame } = face;
    const w = frame.width;
    const h = frame.height;

    const embedding = [];
    for (const type of LANDMARK_TYPES) {
      const landmark = face.landmarks?.[type];
      if (landmark && w > 0 && h > 0) {
        embedding.push((landmark.position.x - frame.left) / w, (landmark.position.y - frame.top) / h);
      } else {
        embedding.push(0, 0);
      }
    }

    embedding.push(w > 0 ? h / w : 0);

    const leftEye = face.landmarks?.leftEye;
    const rightEye = face.landmarks?.rightEye;
    if (leftEye && rightEye && w > 0) {
      const dist = Math.hypot(
        rightEye.position.x - leftEye.position.x,
        rightEye.position.y - leftEye.position.y
      );
      embedding.push(dist / w);
    } else {
      embedding.push(0);
    }

    embedding.push(face.smilingProbability ?? 0);
    embedding.push(face.leftEyeOpenProbability ?? 0);
    embedding.push(face.rightEyeOpenProbability ?? 0);

    if (embedding.length < 10) {
      return {
        success: false,
        error: 'Could not read face landmarks clearly. Please try in better lighting.',
      };
    }

    // MLKit gives eye-open probability directly — same liveness signal as
    // the web EAR calculation, just from the classifier instead of geometry.
    const eyeOpenness =
      face.leftEyeOpenProbability != null && face.rightEyeOpenProbability != null
        ? (face.leftEyeOpenProbability + face.rightEyeOpenProbability) / 2
        : null;

    // Where the face sits in the frame — lets the capture screen insist the
    // face is actually inside the scan square, not just somewhere in shot.
    const faceBox = {
      left: frame.left,
      top: frame.top,
      width: w,
      height: h,
      imageWidth: resized.width,
      imageHeight: resized.height,
    };

    // A real trained model (FaceNet) is far more accurate than the landmark
    // ratios above — use it as the actual embedding whenever it works, and
    // only fall back to the landmark heuristic (already computed above) if
    // the model fails to load or run for any reason. This means the camera
    // itself can never break because of the model — worst case, matching
    // just falls back to the old (less accurate) behavior for that scan.
    try {
      const { generateFaceNetEmbedding } = require('./faceNetModel');
      const faceNetEmbedding = await generateFaceNetEmbedding(resized.uri, frame, resized.width, resized.height);
      return { success: true, embedding: faceNetEmbedding, eyeOpenness, faceBox };
    } catch (faceNetError) {
      console.warn('[faceService] FaceNet embedding failed, falling back to landmark heuristic:', faceNetError?.message);
      // TEMPORARY diagnostic logging — FaceNet has been silently failing on
      // at least one real device with no visible error, so log the actual
      // reason to the backend instead of only a local console.warn nobody
      // can see. Fire-and-forget; never blocks the fallback from returning.
      try {
        const { supabase } = require('./supabase');
        const { Platform } = require('react-native');
        supabase
          .from('facenet_debug_log')
          .insert({
            error_message: String(faceNetError?.message ?? faceNetError),
            error_stack: faceNetError?.stack ? String(faceNetError.stack).slice(0, 2000) : null,
            platform_info: `${Platform.OS} ${Platform.Version}`,
          })
          .then(() => {})
          .catch(() => {});
      } catch (_loggingSetupError) {
        // Never let the debug logging itself break face registration.
      }
      return { success: true, embedding, eyeOpenness, faceBox };
    }
  } catch (error) {
    return { success: false, error: 'Face processing failed. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Public API — unchanged signatures, so no screen needs to know which
// platform implementation actually ran.
// ---------------------------------------------------------------------------
export const generateEmbedding = (imageUri) =>
  Platform.OS === 'web' ? generateEmbeddingWeb(imageUri) : generateEmbeddingNative(imageUri);

// Fast, identity-agnostic liveness sampling — used to poll eye-openness at a
// high enough frequency to actually catch a blink. Native's MLKit classifier
// is already cheap enough per-frame, so it reuses generateEmbedding there.
export const detectLiveness = (imageUri) =>
  Platform.OS === 'web' ? detectLivenessWeb(imageUri) : generateEmbeddingNative(imageUri);

// Scores a live embedding against every stored sample for one identity and
// keeps the best result ("max of N") instead of a single averaged vector —
// a face that's a solid match from any one registered angle can still lose
// to its own blurred average. `storedEmbedding` accepts either a single
// embedding array (legacy accounts) or an array of embedding arrays
// (accounts registered after multi-sample storage was added).
export const verifyFace = (storedEmbedding, newEmbedding) => {
  const isMulti = Array.isArray(storedEmbedding) && Array.isArray(storedEmbedding[0]);
  const samples = isMulti ? storedEmbedding : storedEmbedding ? [storedEmbedding] : [];
  if (samples.length === 0) {
    return Platform.OS === 'web' ? { match: false, score: Infinity } : { match: false, score: 0 };
  }

  if (Platform.OS === 'web') {
    let best = Infinity;
    for (const sample of samples) {
      const distance = euclideanDistance(sample, newEmbedding);
      if (distance < best) best = distance;
    }
    return { match: best <= EUCLIDEAN_MATCH_THRESHOLD, score: best };
  }

  let best = -Infinity;
  for (const sample of samples) {
    const score = cosineSimilarity(sample, newEmbedding);
    if (score > best) best = score;
  }
  return { match: best >= SIMILARITY_THRESHOLD, score: best };
};

// Every already-registered face in a company (owner/admin/user accounts AND
// employees), as {id, name, face_embedding}. Shared by the duplicate-face
// check below and Menu Unlock's cross-check against everyone else.
export async function getRegisteredFaces(companyId) {
  const [{ data: users, error: usersError }, { data: employees, error: employeesError }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, face_embedding, face_embeddings')
      .eq('company_id', companyId)
      .eq('face_registered', true),
    supabase
      .from('employees')
      .select('id, name, face_embedding, face_embeddings')
      .eq('company_id', companyId)
      .eq('face_registered', true),
  ]);
  if (usersError) throw usersError;
  if (employeesError) throw employeesError;
  return [...(users ?? []), ...(employees ?? [])];
}

// Safety check: a face already registered to one person in a company must
// not be registerable again under a second account (owner, manager, or
// employee) — otherwise one person could clock in/out as multiple
// "employees", or two accounts could both unlock with the same face.
// Compares against every already-registered face in the company, excluding
// the record currently being set up.
export async function findDuplicateFaceOwner(companyId, embedding, { excludeUserId, excludeEmployeeId } = {}) {
  const all = await getRegisteredFaces(companyId);
  const candidates = all.filter((c) => c.id !== excludeUserId && c.id !== excludeEmployeeId);

  for (const candidate of candidates) {
    if (!candidate.face_embedding) continue;
    // Deliberately NOT verifyFace()'s live-match threshold — a false accept
    // here permanently blocks legitimate registration with no way to
    // override, so this requires the stricter duplicate-specific threshold.
    const isDuplicate =
      Platform.OS === 'web'
        ? euclideanDistance(candidate.face_embedding, embedding) <= EUCLIDEAN_DUPLICATE_THRESHOLD
        : cosineSimilarity(candidate.face_embedding, embedding) >= SIMILARITY_DUPLICATE_THRESHOLD;
    if (isDuplicate) return candidate.name;
  }
  return null;
}

// Menu Unlock needs more than "is this close enough to my own stored face"
// — if the live face ALSO scores nearly as well against someone else
// registered in the company, that's an ambiguous read, not a confident
// match, and should be rejected rather than guessed (same reasoning as
// findMatchingEmployee's margin check in attendanceService.js, applied to
// a security-sensitive one-to-one unlock instead of a 1-of-many scan).
//
// Split in two: fetch everyone else's face ONCE when the unlock screen
// opens (getOtherRegisteredFaces), then run the actual check synchronously
// on every scan tick (verifyOwnerFaceIsUnambiguous) — re-querying the whole
// company roster every ~700ms while scanning would be wasteful.
export async function getOtherRegisteredFaces(companyId, ownerUserId) {
  return (await getRegisteredFaces(companyId)).filter((c) => c.id !== ownerUserId && c.face_embedding);
}

export function verifyOwnerFaceIsUnambiguous(ownerEmbedding, liveEmbedding, others) {
  const { match: ownerMatches, score: ownerScore } = verifyFace(ownerEmbedding, liveEmbedding);
  if (!ownerMatches) return { match: false, ownerScore, ownerMatches, closestOtherScore: null, margin: null };
  if (!others || others.length === 0) {
    return { match: true, score: ownerScore, ownerScore, ownerMatches, closestOtherScore: null, margin: null };
  }

  const isWeb = Platform.OS === 'web';
  let closestOtherScore = isWeb ? Infinity : 0;
  for (const other of others) {
    const score = isWeb
      ? euclideanDistance(other.face_embedding, liveEmbedding)
      : cosineSimilarity(other.face_embedding, liveEmbedding);
    if (isWeb ? score < closestOtherScore : score > closestOtherScore) closestOtherScore = score;
  }

  const margin = isWeb ? closestOtherScore - ownerScore : ownerScore - closestOtherScore;
  const minMargin = isWeb ? 0.05 : 0.04;
  if (margin < minMargin) {
    return { match: false, ownerScore, ownerMatches, closestOtherScore, margin };
  }

  return { match: true, score: ownerScore, ownerScore, ownerMatches, closestOtherScore, margin };
}

// Guarantees the UI can never hang forever on a stuck native call — always
// resolves (with a rejection) within `ms`, even if the underlying promise
// never settles.
export function withTimeout(promise, ms = 8000, message = 'Processing took too long. Please try again.') {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

