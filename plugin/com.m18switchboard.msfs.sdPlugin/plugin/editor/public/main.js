// Switchboard editor: Wiring: start-up and global handlers (loaded last).
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

// ---------- wiring ----------

function renderAll() {
  renderSettings();
  renderTabs();
  renderGrid();
  renderInspector();
}

async function loadInputs() {
  try {
    const { inputs } = await api('GET', '/api/inputs');
    S.inputs = inputs;
    $('#inputList').innerHTML = '';
    for (const n of inputs) $('#inputList').append(el('option', { value: n }));
  } catch { /* sim may be away */ }
}

async function init() {
  bindSettings();
  bindPages();
  $('#profileSelect').addEventListener('change', e => openFile(e.target.value));
  $('#saveProfile').addEventListener('click', save);
  $('#newProfile').addEventListener('click', () => newProfile(null));
  $('#dupProfile').addEventListener('click', () => newProfile(S.profile));
  $('#delProfile').addEventListener('click', async () => {
    if (!confirm(`Delete ${S.file}? A .bak copy is kept in the profile folder.`)) return;
    await api('DELETE', `/api/profiles/${encodeURIComponent(S.file)}`);
    S.file = null;
    setDirty(false);
    loadFiles();
  });
  $('#saveToLibrary').addEventListener('click', saveToLibrary);
  let libTimer = null;
  $('#libSearch').addEventListener('input', () => { clearTimeout(libTimer); libTimer = setTimeout(renderLibrary, 200); });
  $('#iconSearch').addEventListener('input', drawIcons);
  $('#iconClose').addEventListener('click', () => $('#iconDialog').close());
  $('#iconNone').addEventListener('click', () => { $('#iconDialog').close(); pickCallback(null); });
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') copySel();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'v') paste();
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  });
  window.addEventListener('beforeunload', e => { if (S.dirty || S.kpDirty) { e.preventDefault(); e.returnValue = ''; } });

  bindLook();
  await loadLook();
  S.sim = await api('GET', '/api/state');
  $('#folderNote').textContent = `Profiles are saved in ${S.sim.profilesDir}`;
  S.icons = await api('GET', '/api/icons');
  await loadKeypad();
  await loadFiles();
  loadLibrary();
  loadInputs();
  pollState();
  setInterval(pollState, 1500);
  setInterval(loadInputs, 15000);
}

init().catch(e => status(`Editor failed to start: ${e.message}`, 'bad'));
