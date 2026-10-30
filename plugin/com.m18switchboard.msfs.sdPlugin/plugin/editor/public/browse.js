// Switchboard editor: Browse dialogs: input events, simvars, events.
// Classic script sharing the page's globals with the other editor scripts (index.html order).

'use strict';

// ---------- browse dialog: input events, simvars, events ----------

function chooseFrom(title, rows, onPick) {
  const dlg = el('dialog', { class: 'browse' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el('div', { class: 'dialog-head' }, el('strong', {}, title), el('span', { class: 'spacer' }), el('button', { on: { click: close } }, 'Close')),
    el('div', { class: 'browse-list' }, rows.map(r => el('div', { class: 'browse-row', on: { click: () => { close(); onPick(r); } } },
      el('span', { class: 'mono' }, r.name), el('span', { class: 'muted' }, r.detail || '')))));
  document.body.append(dlg);
  dlg.showModal();
}

const browseCache = {};
async function browse(what, onPick) {
  const titles = { inputs: 'Input events of the loaded aircraft', simvars: 'Common simvars', events: 'Common sim events' };
  const dlg = el('dialog', { class: 'browse' });
  const close = () => { dlg.close(); dlg.remove(); };
  const search = el('input', { placeholder: what === 'inputs' ? 'Search (e.g. LIGHTING, FUEL, AVIONICS)' : 'Search by name, description or category (e.g. NAV1, heading, fuel)' });
  const list = el('div', { class: 'browse-list' }, el('p', { class: 'muted' }, 'Loading…'));
  const custom = el('div', { class: 'browse-custom' });
  dlg.append(el('div', { class: 'dialog-head' }, el('strong', {}, titles[what]), search, el('button', { on: { click: close } }, 'Close')), custom, list);
  document.body.append(dlg);
  dlg.showModal();
  search.focus();

  let rows = [];
  try {
    if (what === 'inputs') {
      list.innerHTML = '';
      list.append(el('p', { class: 'muted' }, 'Reading current values from the sim…'));
      const r = await api('GET', '/api/input-values');
      if (!r.connected) { list.innerHTML = ''; list.append(el('p', { class: 'muted' }, 'MSFS is not connected.')); return; }
      rows = r.inputs.map(i => ({ name: i.name, detail: i.value === null ? '' : `now ${i.value}`, search: i.name }));
      custom.append(el('p', { class: 'muted' }, `${rows.length} input events in ${r.aircraft || 'this aircraft'}. Values are as of opening this list; reopen to refresh, or use Learn.`));
    } else {
      browseCache[what] = browseCache[what] || await api('GET', `/api/catalog/${what}`);
      rows = browseCache[what].map(c => ({ ...c, detail: `${c.desc}${c.unit ? ` · ${c.unit}` : ''}`, search: `${c.name} ${c.desc} ${c.cat}` }));
      const name = el('input', { placeholder: what === 'simvars' ? 'or type any simvar name (also L:vars)' : 'or type any event name' });
      const unit = what === 'simvars' ? el('input', { placeholder: 'unit', list: 'unitList', value: 'number', style: 'width:120px' }) : null;
      custom.append(el('div', { class: 'inline' }, name, unit, el('button', { on: { click: () => {
        if (!name.value.trim()) return;
        close();
        onPick({ name: name.value.trim().toUpperCase().replace(/^L:/, 'L:'), unit: unit ? unit.value : undefined });
      } } }, 'Use')),
      el('p', { class: 'muted' }, what === 'simvars'
        ? `All ${rows.length} simvars of the MSFS 2024 SDK; ★ marks common ones, listed first. Use Test to check one gives a value in this aircraft. Third-party aircraft often use their own L:vars instead.`
        : `All ${rows.length} key events of the MSFS 2024 SDK; ★ marks common ones, listed first. "Send" fires it in the sim right away, so you can see what it does.`));
    }
  } catch (e) {
    list.innerHTML = '';
    list.append(el('p', { class: 'muted' }, e.message));
    return;
  }

  const draw = () => {
    const q = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = rows.filter(r => q.every(w => r.search.toLowerCase().includes(w)));
    list.innerHTML = '';
    let cat = null;
    for (const r of shown.slice(0, 300)) {
      if (r.cat && r.cat !== cat) { cat = r.cat; list.append(el('div', { class: 'browse-cat' }, cat)); }
      const out = el('span', { class: 'test-out' });
      const actions = [];
      if (what === 'simvars') {
        actions.push(el('button', { on: { click: async e => {
          e.stopPropagation();
          out.textContent = '…';
          try { out.textContent = `= ${(await api('POST', '/api/test-var', { var: r.name, unit: r.unit })).value}`; } catch (err) { out.textContent = 'no value'; }
        } } }, 'Test'));
      }
      if (what === 'events') {
        actions.push(el('button', { on: { click: async e => {
          e.stopPropagation();
          try { await api('POST', '/api/send-event', { event: r.name, value: r.value || 0 }); out.textContent = 'sent'; } catch (err) { out.textContent = err.message; }
        } } }, 'Send'));
      }
      list.append(el('div', { class: 'browse-row', on: { click: () => { close(); onPick(r); } } },
        el('span', { class: 'mono' }, r.name), el('span', { class: 'muted' }, r.detail), el('span', { class: 'spacer' }), out, ...actions));
    }
    if (!shown.length) list.append(el('p', { class: 'muted' }, 'Nothing matches.'));
    if (shown.length > 300) list.append(el('p', { class: 'muted' }, `${shown.length - 300} more: narrow the search.`));
  };
  search.addEventListener('input', draw);
  draw();
}
