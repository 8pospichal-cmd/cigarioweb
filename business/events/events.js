/* Cigario Business — Events (vanilla JS, English). Standalone page, reuses window.sb. */
(function () {
  var sb = window.sb;
  var EVENTS_LOCKED = true;
  var TIME_OPTS = (function () {
    var out = [];
    for (var h = 0; h < 24; h++) for (var m = 0; m < 60; m += 30)
      out.push((h < 10 ? '0' + h : h) + ':' + (m === 0 ? '00' : '30'));
    return out;
  })();
  var REC_LABELS = { none: 'One-off', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

  var user = null, venues = [], editingId = null, photo = null, fileInput, hasApprovedVenue = false;

  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function msg(el, t, k) { var m = $(el); m.textContent = t; m.className = 'bz-msg show ' + (k || ''); }
  function clearMsg(el) { $(el).className = 'bz-msg'; }
  function view(w) { ['bz-auth', 'bz-dash', 'bz-form'].forEach(hide); show('bz-' + w); }
  function showPublicNav(showIt) {
    Array.prototype.forEach.call(document.querySelectorAll('.bz-public-link'), function (el) {
      el.classList.toggle('hidden', !showIt);
    });
  }
  function setProfileMenu(open) {
    var menu = $('bz-profile-dropdown'), btn = $('bz-profile-button');
    if (!menu || !btn) return;
    menu.classList.toggle('hidden', !open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function bindProfileMenu() {
    var btn = $('bz-profile-button');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setProfileMenu($('bz-profile-dropdown').classList.contains('hidden'));
    });
    document.addEventListener('click', function () { setProfileMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setProfileMenu(false); });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function localDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(d) { return pad(d.getHours()) + ':' + (d.getMinutes() < 30 ? '00' : '30'); }
  function fmt(d) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  function nextOccurrence(ev, from) {
    from = from || new Date();
    var start = new Date(ev.starts_at);
    var until = ev.recurrence_until ? new Date(ev.recurrence_until) : null;
    var rec = ev.recurrence || 'none';
    if (rec === 'none') { var end = ev.ends_at ? new Date(ev.ends_at) : start; return end >= from ? start : null; }
    if (start >= from) return start;
    if (rec === 'monthly') {
      var d = new Date(start);
      while (d < from) { d.setMonth(d.getMonth() + 1); if (until && d > until) return null; }
      return (until && d > until) ? null : d;
    }
    var stepMs = (rec === 'biweekly' ? 14 : 7) * 86400000;
    var steps = Math.ceil((from - start) / stepMs);
    var d2 = new Date(start.getTime() + steps * stepMs);
    return (until && d2 > until) ? null : d2;
  }

  // ── Auth ──
  async function init() {
    fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    fileInput.addEventListener('change', onFilePicked);
    document.body.appendChild(fileInput);
    bindProfileMenu();

    // time options
    var ts = $('e-time'); TIME_OPTS.forEach(function (t) { var o = document.createElement('option'); o.textContent = t; ts.appendChild(o); });
    ts.value = '18:00';

    $('e-recurrence').addEventListener('change', function () { $('e-until-wrap').classList.toggle('hidden', this.value === 'none'); });

    var s = await sb.auth.getSession();
    setUser(s.data.session ? s.data.session.user : null);
    sb.auth.onAuthStateChange(function (_e, session) { handleAuthChange(session); });
  }
  function handleAuthChange(session) {
    var nextUser = session ? session.user : null;
    if (!nextUser) { setUser(null); return; }
    if (user && user.id === nextUser.id) {
      user = nextUser;
      if ($('bz-userline')) $('bz-userline').textContent = user.email || '';
      return;
    }
    setUser(nextUser);
  }
  function setAdminTabs(on) {
    Array.prototype.forEach.call(document.querySelectorAll('.bz-tab-admin'), function (el) { el.classList.toggle('hidden', !on); });
  }
  async function setUser(u) {
    user = u;
    if (!user) { showPublicNav(true); hide('bz-profile-menu'); hide('bz-nav'); hide('bz-sidebar'); setProfileMenu(false); view('auth'); return; }
    showPublicNav(false);
    $('bz-userline').textContent = user.email || ''; show('bz-profile-menu'); show('bz-nav'); show('bz-sidebar'); setProfileMenu(false);
    var r = await sb.rpc('is_admin'); setAdminTabs(!!(r && r.data === true));
    view('dash');
    await loadVenues();
    loadEvents();
  }
  $('bz-send').addEventListener('click', async function () {
    this.disabled = true; this.textContent = 'Opening Google...';
    var res = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/business/events/' }
    });
    if (res.error) {
      this.disabled = false; this.textContent = 'Continue with Google';
      msg('bz-auth-msg', 'Error: ' + res.error.message, 'err');
    }
  });
  $('bz-signout').addEventListener('click', async function (e) { e.preventDefault(); await sb.auth.signOut(); });

  // ── Venues ──
  async function loadVenues() {
    var res = await sb.rpc('get_my_business_places');
    venues = (res.data || []);
    var approved = venues.filter(function (v) { return v.status === 'approved'; });
    var sel = $('e-venue'); sel.innerHTML = '';
    approved.forEach(function (v) {
      var o = document.createElement('option'); o.value = v.id; o.textContent = v.name + (v.city ? ' · ' + v.city : ''); sel.appendChild(o);
    });
    hasApprovedVenue = approved.length > 0;
    if (hasApprovedVenue) { hide('bz-no-venue'); } else { show('bz-no-venue'); }
  }

  // ── Events list ──
  async function loadEvents() {
    var box = $('bz-events'); box.innerHTML = '<div class="bz-empty">Loading…</div>';
    var ids = venues.map(function (v) { return v.id; });
    if (EVENTS_LOCKED) { box.innerHTML = ''; return; }
    if (!ids.length) { box.innerHTML = ''; return; }
    var res = await sb.from('venue_events').select('*').in('place_id', ids).order('starts_at', { ascending: true });
    if (res.error) {
      var em = res.error.message || '';
      box.innerHTML = /venue_events/i.test(em)
        ? '<div class="bz-empty">Run the events SQL migration (03_venue_events.sql) in Supabase to enable events.</div>'
        : '<div class="bz-empty">Error: ' + em + '</div>';
      return;
    }
    var rows = res.data || [];
    if (!rows.length) { box.innerHTML = '<div class="bz-empty">No events yet.</div>'; return; }
    var venueName = {}; venues.forEach(function (v) { venueName[v.id] = v.name; });
    var upcoming = [], ended = [];
    rows.forEach(function (e) { var n = nextOccurrence(e); if (n) upcoming.push({ e: e, when: n }); else ended.push({ e: e, when: new Date(e.starts_at) }); });
    upcoming.sort(function (a, b) { return a.when - b.when; });
    ended.sort(function (a, b) { return b.when - a.when; });
    box.innerHTML = '';
    if (upcoming.length) { box.appendChild(group('Upcoming', upcoming, venueName)); }
    if (ended.length) { box.appendChild(group('Ended', ended, venueName)); }
  }
  var ICON = {
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13M10 11v6M14 11v6"/></svg>'
  };

  function eventStatus(e, next) {
    if (e.status === 'pending') return { label: 'Pending review', kind: 'pending' };
    if (e.status === 'hidden') return { label: 'Hidden', kind: 'hidden' };
    if (e.status === 'draft') return { label: 'Draft', kind: 'draft' };
    if (!next) return { label: 'Ended', kind: 'ended' };
    var now = Date.now(), start = next.getTime();
    var dur = e.ends_at ? (new Date(e.ends_at) - new Date(e.starts_at)) : 3 * 3600000;
    if (!(dur > 0)) dur = 3 * 3600000;
    if (now >= start && now <= start + dur) return { label: 'Live now', kind: 'live' };
    return { label: 'Upcoming', kind: 'upcoming' };
  }
  function relDay(when) {
    if (!when) return null;
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var d1 = new Date(when); d1.setHours(0, 0, 0, 0);
    var diff = Math.round((d1 - d0) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(when);
    return null;
  }
  function evBtn(label, cls, onClick) {
    var b = document.createElement('button'); b.type = 'button';
    b.className = 'bz-ev-btn ' + (cls || ''); b.innerHTML = label;
    b.addEventListener('click', onClick); return b;
  }

  function renderCard(e, when, venueName) {
    var next = nextOccurrence(e);
    var st = eventStatus(e, next);
    var card = document.createElement('article'); card.className = 'bz-event-card';

    var photo = document.createElement('div');
    photo.className = 'bz-event-photo' + (e.image_url ? '' : ' is-empty');
    if (e.image_url) photo.style.backgroundImage = 'url("' + e.image_url + '")';
    else photo.innerHTML = ICON.cal;
    var badge = document.createElement('span');
    badge.className = 'bz-event-badge is-' + st.kind; badge.textContent = st.label;
    photo.appendChild(badge);
    if (e.recurrence && e.recurrence !== 'none') {
      var rec = document.createElement('span');
      rec.className = 'bz-event-recur'; rec.textContent = REC_LABELS[e.recurrence];
      photo.appendChild(rec);
    }
    photo.title = 'Edit event';
    photo.addEventListener('click', function () { openForm(e.id); });

    var body = document.createElement('div'); body.className = 'bz-event-body';
    var rel = relDay(next || when);
    if (rel) { var r = document.createElement('span'); r.className = 'bz-event-rel'; r.textContent = rel; body.appendChild(r); }

    var h = document.createElement('h3'); h.className = 'bz-event-title'; h.textContent = e.title;
    h.title = 'Edit event'; h.addEventListener('click', function () { openForm(e.id); });
    body.appendChild(h);

    var meta = document.createElement('div'); meta.className = 'bz-event-meta';
    meta.innerHTML =
      '<span class="bz-event-meta-row">' + ICON.cal + '<span>' + escapeHtml(fmt(when)) + '</span></span>' +
      '<span class="bz-event-meta-row">' + ICON.pin + '<span>' + escapeHtml(venueName[e.place_id] || 'Your venue') + '</span></span>';
    body.appendChild(meta);

    if (e.description) {
      var p = document.createElement('p'); p.className = 'bz-event-desc'; p.textContent = e.description;
      body.appendChild(p);
    }

    var actions = document.createElement('div'); actions.className = 'bz-event-actions';
    actions.appendChild(evBtn('Edit', 'bz-ev-btn-primary', function () { openForm(e.id); }));
    actions.appendChild(evBtn(next ? 'Duplicate' : 'Re-run', '', function () { duplicateEvent(e.id); }));
    actions.appendChild(evBtn(ICON.trash, 'bz-ev-btn-danger', function () { deleteEvent(e.id, e.title); }));
    body.appendChild(actions);

    card.appendChild(photo); card.appendChild(body);
    return card;
  }

  function group(title, list, venueName) {
    var wrap = document.createElement('div'); wrap.className = 'bz-event-group';
    var lbl = document.createElement('p'); lbl.className = 'bz-section-label';
    lbl.style.margin = '24px 0 12px'; lbl.textContent = title; wrap.appendChild(lbl);
    var grid = document.createElement('div'); grid.className = 'bz-events-grid';
    list.forEach(function (x) { grid.appendChild(renderCard(x.e, x.when, venueName)); });
    wrap.appendChild(grid);
    return wrap;
  }

  async function duplicateEvent(id) { await openForm(id); makeCopy(); }
  async function deleteEvent(id, title) {
    if (!confirm('Delete "' + (title || 'this event') + '"? This cannot be undone.')) return;
    var res = await sb.from('venue_events').delete().eq('id', id);
    if (res.error) { alert('Could not delete: ' + res.error.message); return; }
    loadEvents();
  }
  function makeCopy() {
    editingId = null;
    $('bz-form-title').textContent = 'New event (copy)';
    $('e-delete').classList.add('hidden'); $('e-duplicate').classList.add('hidden');
    $('e-date').value = localDate(new Date(Date.now() + 86400000));
    msg('bz-form-msg', 'Copy ready — set a new date and Save.', 'ok');
  }

  $('e-hero-cta').addEventListener('click', function () {
    if (EVENTS_LOCKED) {
      var locked = $('bz-events-locked');
      if (locked) locked.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (hasApprovedVenue) { openForm(null); return; }
    var nv = $('bz-no-venue');
    if (nv) { nv.classList.remove('hidden'); nv.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  $('e-cancel').addEventListener('click', function () { view('dash'); loadEvents(); });

  // ── Photo (single) ──
  function renderPhoto() {
    var wrap = $('bz-photo'); wrap.innerHTML = '';
    var slot = document.createElement('div');
    slot.className = 'bz-slot' + (photo ? ' filled' : '');
    if (photo) {
      slot.innerHTML = '<img src="' + photo + '" alt=""><button class="bz-slot-del" title="Remove">×</button>';
      slot.querySelector('.bz-slot-del').addEventListener('click', function (e) { e.stopPropagation(); photo = null; renderPhoto(); });
    } else {
      slot.innerHTML = '<span class="bz-slot-plus">+</span><span class="bz-slot-label">Add photo</span>';
      slot.addEventListener('click', function () { fileInput.value = ''; fileInput.click(); });
    }
    wrap.appendChild(slot);
  }
  function resizeImage(file, max) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (Math.max(w, h) > max) { var s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  async function onFilePicked() {
    var file = this.files && this.files[0]; if (!file) return;
    try {
      var blob = await resizeImage(file, 1600);
      var path = user.id + '/event-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg';
      var up = await sb.storage.from('place-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) { msg('bz-form-msg', 'Upload error: ' + up.error.message, 'err'); return; }
      photo = sb.storage.from('place-photos').getPublicUrl(path).data.publicUrl; clearMsg('bz-form-msg'); renderPhoto();
    } catch (e) { msg('bz-form-msg', 'Could not process the image.', 'err'); }
  }

  // ── Open form ──
  async function openForm(id) {
    editingId = id; photo = null; clearMsg('bz-form-msg');
    $('e-title').value = ''; $('e-desc').value = '';
    $('e-date').value = localDate(new Date(Date.now() + 86400000));
    $('e-time').value = '18:00'; $('e-recurrence').value = 'none';
    $('e-until').value = ''; $('e-until-wrap').classList.add('hidden');
    $('e-delete').classList.add('hidden'); $('e-duplicate').classList.add('hidden');
    $('bz-form-title').textContent = id ? 'Edit event' : 'New event';
    renderPhoto(); view('form');

    if (id) {
      var res = await sb.from('venue_events').select('*').eq('id', id).single();
      if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
      var e = res.data; var d = new Date(e.starts_at);
      $('e-venue').value = e.place_id;
      $('e-title').value = e.title || ''; $('e-desc').value = e.description || '';
      $('e-date').value = localDate(d); $('e-time').value = localTime(d);
      $('e-recurrence').value = e.recurrence || 'none';
      $('e-until-wrap').classList.toggle('hidden', (e.recurrence || 'none') === 'none');
      if (e.recurrence_until) $('e-until').value = e.recurrence_until;
      photo = e.image_url || null; renderPhoto();
      $('e-delete').classList.remove('hidden'); $('e-duplicate').classList.remove('hidden');
    }
  }

  function collect() {
    var place_id = $('e-venue').value;
    var title = $('e-title').value.trim();
    var date = $('e-date').value, time = $('e-time').value;
    if (!place_id) { msg('bz-form-msg', 'Pick a venue (you need an approved venue).', 'err'); return null; }
    if (!title) { msg('bz-form-msg', 'Enter a title.', 'err'); return null; }
    if (!date || !time) { msg('bz-form-msg', 'Pick a date and start time.', 'err'); return null; }
    var starts = new Date(date + 'T' + time + ':00');
    var rec = $('e-recurrence').value;
    return {
      place_id: place_id, created_by: user.id, title: title,
      description: $('e-desc').value.trim() || null, image_url: photo,
      starts_at: starts.toISOString(),
      recurrence: rec, recurrence_until: (rec !== 'none' && $('e-until').value) ? $('e-until').value : null,
      status: 'approved',
    };
  }

  $('e-save').addEventListener('click', async function () {
    if (EVENTS_LOCKED) {
      msg('bz-form-msg', 'Event publishing is currently locked. This feature is coming soon.', 'err');
      return;
    }
    var payload = collect(); if (!payload) return;
    this.disabled = true; this.textContent = 'Saving…';
    var res = editingId ? await sb.from('venue_events').update(payload).eq('id', editingId) : await sb.from('venue_events').insert(payload);
    this.disabled = false; this.textContent = 'Save event';
    if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
    view('dash'); loadEvents();
  });

  $('e-duplicate').addEventListener('click', function () { makeCopy(); });

  $('e-delete').addEventListener('click', async function () {
    if (!editingId || !confirm('Delete this event?')) return;
    var res = await sb.from('venue_events').delete().eq('id', editingId);
    if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
    view('dash'); loadEvents();
  });

  init();
})();
