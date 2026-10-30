// Calculate cosine similarity between two face embeddings
// Returns value between 0 and 1. Above 0.85 = same person.
export const cosineSimilarity = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

// face-api.js's 128-d descriptors are meant to be compared via Euclidean
// distance (its own documented convention), not cosine similarity — using
// the wrong metric/threshold here would cause real false accepts/rejects.
export const euclideanDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
};

export const EUCLIDEAN_MATCH_THRESHOLD = 0.5;

export function averageEmbeddings(embeddings) {
  const length = embeddings[0].length;
  const sum = new Array(length).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < length; i++) {
      sum[i] += embedding[i];
    }
  }
  return sum.map((value) => value / embeddings.length);
}

// Native runs a real trained model (FaceNet, 128-dim, via faceNetModel.js)
// instead of the old landmark-ratio heuristic, with that heuristic kept only
// as an automatic fallback if the model fails to load/run on a given device.
// 0.62 was a literature-typical starting point, but real usage showed it
// was too loose — different people (e.g. two coworkers) were matching each
// other, both on Menu Unlock and the attendance scanner. That's a false
// ACCEPT (the worse failure mode for anything security/attendance-related),
// so this is raised meaningfully rather than nudged; expect it may need
// further tuning based on real results, but err toward stricter, not looser.
export const SIMILARITY_THRESHOLD = 0.8;

// Duplicate-registration checks ("is this face already registered to
// someone else?") need a stricter bar than live check-in matching — a false
// accept here permanently blocks someone from registering at all, with no
// way to override, whereas a live check-in false-reject just means "try
// scanning again." So these thresholds require higher confidence than
// SIMILARITY_THRESHOLD / EUCLIDEAN_MATCH_THRESHOLD above.
export const EUCLIDEAN_DUPLICATE_THRESHOLD = 0.35;
export const SIMILARITY_DUPLICATE_THRESHOLD = 0.9;
export const MAX_FACE_ATTEMPTS = 3;
export const MAX_PIN_ATTEMPTS = 3;
export const PIN_LOCKOUT_MS = 5 * 60 * 1000;

