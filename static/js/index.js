const listEl = document.getElementById('map-list');
const errorEl = document.getElementById('error');
const formEl = document.getElementById('create-form');
const nameEl = document.getElementById('new-name');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = res.statusText;
    try { const d = await res.json(); if (d.detail) detail = d.detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function loadMaps() {
  const data = await api('/api/maps');
  listEl.innerHTML = '';
  if (!data.maps.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока нет ни одной карты — создай первую выше.';
    listEl.appendChild(li);
    return;
  }
  for (const name of data.maps) {
    const li = document.createElement('li');
    li.className = 'map-card';

    const link = document.createElement('a');
    link.className = 'map-link';
    link.href = '/static/map.html?map=' + encodeURIComponent(name);
    link.textContent = name;
    li.appendChild(link);

    const actions = document.createElement('div');
    actions.className = 'map-actions';

    const renameBtn = document.createElement('button');
    renameBtn.textContent = 'Переименовать';
    renameBtn.addEventListener('click', () => renameMap(name));

    const delBtn = document.createElement('button');
    delBtn.className = 'danger';
    delBtn.textContent = 'Удалить';
    delBtn.addEventListener('click', () => deleteMap(name));

    actions.append(renameBtn, delBtn);
    li.appendChild(actions);
    listEl.appendChild(li);
  }
}

async function renameMap(oldName) {
  const newName = prompt('Новое имя карты:', oldName);
  if (newName === null || !newName.trim() || newName === oldName) return;
  try {
    await api('/api/maps/' + encodeURIComponent(oldName) + '/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    await loadMaps();
  } catch (err) { showError(err.message); }
}

async function deleteMap(name) {
  if (!confirm('Удалить карту "' + name + '"? Восстановить будет нельзя.')) return;
  try {
    await api('/api/maps/' + encodeURIComponent(name), { method: 'DELETE' });
    await loadMaps();
  } catch (err) { showError(err.message); }
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.add('hidden');
  try {
    const data = await api('/api/maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameEl.value }),
    });
    nameEl.value = '';
    location.href = '/static/map.html?map=' + encodeURIComponent(data.name);
  } catch (err) { showError(err.message); }
});

loadMaps().catch(err => showError('Сервер недоступен: ' + err.message));
