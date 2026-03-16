// Mid-build checkpoint — saves partial progress to a separate localStorage key.
// If the browser dies mid-pipeline, the generated code is recovered on next load.

var CHECKPOINT_KEY = 'bldr_checkpoint'

export function saveCheckpoint(data) {
  try {
    data.ts = new Date().toISOString()
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(data))
  } catch (e) {
    // Best-effort — if storage is full, losing the checkpoint is no worse than today
    console.warn('Checkpoint save failed:', e.message)
  }
}

export function clearCheckpoint() {
  try { localStorage.removeItem(CHECKPOINT_KEY) } catch (e) {}
}

export function loadCheckpoint() {
  try {
    var raw = localStorage.getItem(CHECKPOINT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}
