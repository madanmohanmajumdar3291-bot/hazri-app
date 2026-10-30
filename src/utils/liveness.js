// A tiny state machine: feed it eye-openness readings over time, and it
// reports whether it has seen a full open -> closed -> open cycle (a blink)
// within the tracking window. A held-up photo's "eyes" never change value,
// so it can never produce this transition — only a live face can.
//
// Uses an ADAPTIVE baseline instead of a fixed threshold: different cameras,
// distances and lighting produce very different absolute EAR/probability
// values, so a hardcoded "closed below 0.21" number can simply be
// unreachable on some setups. Instead this tracks the highest ("most open")
// value seen recently as the baseline, and calls it a blink once the value
// dips to a fraction of that baseline and then recovers.
//
// A held-up photo isn't perfectly static in front of a real camera though —
// auto-exposure/autofocus hunting and sensor noise cause small frame-to-frame
// value swings that a single-frame threshold check could mistake for a
// blink. CONFIRM_SAMPLES requires the dip (and the recovery) to persist
// across multiple consecutive frames before it's trusted as real, which
// random single-frame noise essentially never does.
const DROP_RATIO = 0.75; // eyes considered "closing" below 75% of the open baseline
const RISE_RATIO = 0.85; // eyes considered "open again" above 85% of the open baseline
const BASELINE_DECAY = 0.995; // baseline slowly relaxes so it doesn't get stuck on a stale high
const CONFIRM_SAMPLES = 2; // consecutive frames required before trusting a state transition

export function createBlinkDetector() {
  let state = 'open';
  let blinked = false;
  let baseline = null;
  let lastValue = null;
  let samples = 0;
  let candidateCount = 0;

  function addSample(value) {
    if (value == null || Number.isNaN(value)) return;
    lastValue = value;
    samples += 1;

    if (baseline == null) {
      baseline = value;
      return;
    }

    if (state === 'open') {
      if (value > baseline) {
        baseline = value;
        candidateCount = 0;
      } else {
        baseline *= BASELINE_DECAY;
      }

      if (baseline > 0 && value <= baseline * DROP_RATIO) {
        candidateCount += 1;
        if (candidateCount >= CONFIRM_SAMPLES) {
          state = 'closed';
          candidateCount = 0;
        }
      } else {
        candidateCount = 0;
      }
    } else if (state === 'closed') {
      if (baseline > 0 && value >= baseline * RISE_RATIO) {
        candidateCount += 1;
        if (candidateCount >= CONFIRM_SAMPLES) {
          state = 'open';
          blinked = true;
          candidateCount = 0;
        }
      } else {
        candidateCount = 0;
      }
    }
  }

  function hasBlinked() {
    return blinked;
  }

  function reset() {
    state = 'open';
    blinked = false;
    baseline = null;
    lastValue = null;
    samples = 0;
    candidateCount = 0;
  }

  function getDebug() {
    return { state, baseline, lastValue, samples, blinked, candidateCount };
  }

  return { addSample, hasBlinked, reset, getDebug };
}

