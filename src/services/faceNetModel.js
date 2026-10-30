// On-device face-recognition embeddings using a real trained model
// (Google FaceNet, converted to TFLite — 160x160 input, 128-dim output),
// instead of the hand-built landmark-ratio heuristic in faceService.js.
// Model + preprocessing spec matches the reference Android implementation
// at github.com/shubham0204/FaceRecognition_With_FaceNet_Android
// (Apache-2.0), which is what assets/models/facenet.tflite was sourced from.
import { Platform } from 'react-native';
// The plain "expo-file-system" import only exposes the new File/Directory
// class API — readAsStringAsync/EncodingType throw at runtime from there,
// which was silently sending every face embedding down the cruder
// landmark-heuristic fallback in faceService.js instead of this real model.
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import jpeg from 'jpeg-js';

const MODEL_INPUT_SIZE = 160;
const EMBEDDING_DIM = 128;

let modelPromise = null;

// Passing the raw require() module id straight to loadTensorflowModel()
// matches react-native-fast-tflite's own documented usage, but on this
// Expo/Android setup it crashed with "MalformedURLException: no protocol:
// assets_models_facenet" — the library's native asset loader received a
// bare Android resource name instead of a real URI and tried to construct
// a java.net.URL directly from it. Resolving the module through expo-asset
// FIRST gives a real file:// URI (downloading it out of the APK to local
// storage on first use, cached after), which is what the library's own
// docs show as the alternative loading form: loadTensorflowModel({url}).
// This was the actual reason every device silently fell back to the much
// weaker landmark-heuristic embedding instead of the real FaceNet model.
async function resolveModelUri() {
  const { Asset } = require('expo-asset');
  const asset = Asset.fromModule(require('../../assets/models/facenet.tflite'));
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error('Could not resolve facenet.tflite asset URI');
  return uri;
}

function getModel() {
  if (Platform.OS === 'web') return Promise.resolve(null);
  if (!modelPromise) {
    // Deferred require so this whole module — including the native
    // react-native-fast-tflite import — never even loads on web, where it
    // doesn't exist.
    const { loadTensorflowModel } = require('react-native-fast-tflite');
    modelPromise = resolveModelUri()
      // `delegates` is a required argument (empty array = default CPU
      // delegate) — omitting it reached the native side as undefined and
      // crashed with "Value is undefined, expected an Object".
      .then((uri) => loadTensorflowModel({ url: uri }, []))
      .catch((error) => {
        // Reset so a later call can retry rather than being stuck on one
        // failed attempt forever.
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

// Crops to the detected face (with headroom padding so the model sees the
// same kind of framing it was trained on, not a tight crop), then resizes
// to the model's fixed 160x160 input.
async function cropAndResizeFace(imageUri, faceBox, imageWidth, imageHeight) {
  const padding = 0.25;
  const boxW = faceBox.width * (1 + padding * 2);
  const boxH = faceBox.height * (1 + padding * 2);
  const originX = Math.round(Math.max(0, faceBox.left - faceBox.width * padding));
  const originY = Math.round(Math.max(0, faceBox.top - faceBox.height * padding));
  const width = Math.round(Math.min(boxW, imageWidth - originX));
  const height = Math.round(Math.min(boxH, imageHeight - originY));

  const result = await ImageManipulator.manipulateAsync(
    imageUri,
    [
      { crop: { originX, originY, width, height } },
      { resize: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE } },
    ],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
  );
  return result.uri;
}

// tf.image.per_image_standardization: every pixel value (across all
// channels combined) is normalized by the whole image's own mean/stddev —
// NOT a fixed (x-127.5)/128 formula. Must match the reference exactly or
// embeddings come out systematically wrong.
function buildStandardizedInput(rgba, pixelCount) {
  const values = new Float32Array(pixelCount * 3);
  let sum = 0;
  let i = 0;
  for (let p = 0; p < pixelCount; p++) {
    const srcOffset = p * 4; // RGBA -> drop alpha
    const r = rgba[srcOffset];
    const g = rgba[srcOffset + 1];
    const b = rgba[srcOffset + 2];
    values[i++] = r;
    values[i++] = g;
    values[i++] = b;
    sum += r + g + b;
  }
  const n = values.length;
  const mean = sum / n;
  let variance = 0;
  for (let j = 0; j < n; j++) {
    const d = values[j] - mean;
    variance += d * d;
  }
  const std = Math.max(Math.sqrt(variance / n), 1 / Math.sqrt(n));
  for (let j = 0; j < n; j++) {
    values[j] = (values[j] - mean) / std;
  }
  return values;
}

// Returns a 128-number array, or throws — callers are expected to fall back
// to the older landmark-based embedding on any failure (model didn't load,
// device unsupported, decode error, etc.) so a broken model never breaks
// the camera itself.
export async function generateFaceNetEmbedding(imageUri, faceBox, imageWidth, imageHeight) {
  const model = await getModel();
  if (!model) throw new Error('FaceNet model unavailable on this platform');

  const croppedUri = await cropAndResizeFace(imageUri, faceBox, imageWidth, imageHeight);
  const base64 = await FileSystem.readAsStringAsync(croppedUri, { encoding: FileSystem.EncodingType.Base64 });
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const decoded = jpeg.decode(bytes, { useTArray: true });
  const pixelCount = decoded.width * decoded.height;
  const input = buildStandardizedInput(decoded.data, pixelCount);

  const outputs = await model.run([input.buffer]);
  const embedding = new Float32Array(outputs[0]);
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Unexpected FaceNet output size: ${embedding.length}`);
  }
  return Array.from(embedding);
}

