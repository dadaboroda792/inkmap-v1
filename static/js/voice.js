let rec = null;
let chunks = [];
let startedAt = 0;
let stopCb = null;

export function isRecording() { return Boolean(rec); }

export function onRecordingStopped(cb) { stopCb = cb; }

function extFromMime(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

export function elapsedMs() {
  return rec ? Date.now() - startedAt : 0;
}

export async function startRecording() {
  if (rec) throw new Error('Уже идёт запись');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const mime = (window.MediaRecorder && MediaRecorder.isTypeSupported)
    ? candidates.find(t => MediaRecorder.isTypeSupported(t)) : '';
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  startedAt = Date.now();
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    const type = rec.mimeType || 'audio/webm';
    const duration = (Date.now() - startedAt) / 1000;
    rec = null;
    if (!chunks.length) { chunks = []; if (stopCb) stopCb(null, 0); return; }
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (stopCb) stopCb(blob, duration, extFromMime(type));
  };
  rec.start(250);
}

export function stopRecording() {
  if (rec && rec.state !== 'inactive') rec.stop();
}
