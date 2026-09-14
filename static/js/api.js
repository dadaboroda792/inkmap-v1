async function unwrap(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try { const d = await res.json(); if (d.detail) detail = d.detail; } catch {}
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return res.json();
}

export async function getMaps() { return unwrap(await fetch('/api/maps')); }
export async function createMap(name) {
  return unwrap(await fetch('/api/maps', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }));
}
export async function getMap(name) {
  return unwrap(await fetch('/api/maps/' + encodeURIComponent(name)));
}
export async function saveMap(name, data, opts = {}) {
  return unwrap(await fetch('/api/maps/' + encodeURIComponent(name), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    keepalive: Boolean(opts.keepalive),
  }));
}
export async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file);
  return (await unwrap(await fetch('/api/images', { method: 'POST', body: fd }))).url;
}
export async function uploadMedia(blob, filename) {
  const fd = new FormData();
  fd.append('file', blob, filename);
  return (await unwrap(await fetch('/api/media', { method: 'POST', body: fd }))).url;
}
