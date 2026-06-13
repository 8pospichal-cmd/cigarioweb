/* Cigario Business — admin moderation (vanilla JS, English) */
(function () {
  var sb = window.sb;
  var TYPE_LABELS = { lounge: 'Lounge', bar: 'Bar', shop: 'Shop', restaurant: 'Restaurant', outdoor: 'Outdoor' };
  var STATUS_LABELS = { approved: 'Approved', pending: 'Pending', draft: 'Draft', hidden: 'Changes requested' };
  var REC_LABELS = { none: 'One-off', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };
  var user = null, isAdmin = false, filter = 'pending', query = '', rowsCache = [], mode = 'venues', eventFilter = 'live';
  function fmtDate(s) {
    if (!s) return '';
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(s));
  }

  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function msg(el, t, k) { var m = $(el); m.textContent = t; m.className = 'bz-msg show ' + (k || ''); }
  function view(w) { ['bz-auth', 'bz-noadmin', 'bz-queue'].forEach(hide); show('bz-' + w); }
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

  async function init() {
    bindProfileMenu();
    var s = await sb.auth.getSession();
    await setUser(s.data.session ? s.data.session.user : null);
    sb.auth.onAuthStateChange(function (_e, session) { setUser(session ? session.user : null); });
  }
  async function setUser(u) {
    user = u;
    if (!user) { showPublicNav(true); hide('bz-profile-menu'); hide('bz-nav'); hide('bz-sidebar'); setProfileMenu(false); view('auth'); return; }
    showPublicNav(false);
    $('bz-userline').textContent = user.email || ''; show('bz-profile-menu'); setProfileMenu(false);
    var r = await sb.rpc('is_admin');
    isAdmin = !!(r && r.data === true);
    if (!isAdmin) { hide('bz-nav'); hide('bz-sidebar'); view('noadmin'); return; }
    show('bz-nav'); show('bz-sidebar');
    Array.prototype.forEach.call(document.querySelectorAll('.bz-tab-admin'), function (el) { el.classList.remove('hidden'); });
    view('queue'); load();
  }
  $('bz-send').addEventListener('click', async function () {
    var email = $('bz-email').value.trim();
    if (!email) { msg('bz-auth-msg', 'Please enter your email.', 'err'); return; }
    this.disabled = true; this.textContent = 'Logging in...';
    var res = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.origin + '/business/admin/' } });
    this.disabled = false; this.textContent = 'Login';
    msg('bz-auth-msg', res.error ? ('Error: ' + res.error.message) : 'Check your inbox and click the link.', res.error ? 'err' : 'ok');
  });
  $('bz-signout').addEventListener('click', async function (e) { e.preventDefault(); await sb.auth.signOut(); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (b) {
    b.addEventListener('click', function () { filter = b.getAttribute('data-filter'); load(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-efilter]'), function (b) {
    b.addEventListener('click', function () { eventFilter = b.getAttribute('data-efilter'); load(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
    b.addEventListener('click', function () {
      mode = b.getAttribute('data-mode');
      Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (x) { x.classList.toggle('bz-mode-active', x === b); });
      $('bz-venue-filters').classList.toggle('hidden', mode !== 'venues');
      $('bz-event-filters').classList.toggle('hidden', mode !== 'events');
      var s = $('bz-admin-search'); s.value = ''; query = '';
      s.placeholder = mode === 'events' ? 'Event title, venue...' : 'Venue, city, address, description...';
      load();
    });
  });
  $('bz-admin-search').addEventListener('input', function () {
    query = this.value.trim().toLowerCase();
    renderList();
  });

  async function load() {
    var list = $('bz-list'); list.innerHTML = '<div class="bz-empty">Loading…</div>';
    if (mode === 'events') return loadEvents();
    $('bz-queue-sub').textContent = filter === 'pending' ? 'Pending review.' : (filter === 'approved' ? 'Approved venues.' : 'Listings returned to owners for changes.');
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (b) {
      var active = b.getAttribute('data-filter') === filter;
      b.classList.toggle('bz-filter-active', active);
    });
    var res = await sb.from('smoking_places').select('*').eq('status', filter).order('submitted_at', { ascending: false });
    if (res.error) { list.innerHTML = '<div class="bz-empty">Error: ' + res.error.message + '</div>'; return; }
    rowsCache = res.data || [];
    renderList();
  }
  function renderList() {
    if (mode === 'events') return renderEventList();
    var list = $('bz-list');
    var rows = rowsCache.filter(function (p) {
      if (!query) return true;
      return [p.name, p.type, p.city, p.address, p.description, p.website_url, p.owner_user_id]
        .filter(Boolean).join(' ').toLowerCase().indexOf(query) !== -1;
    });
    if (!rows.length) { list.innerHTML = '<div class="bz-empty">Nothing here.</div>'; return; }
    list.innerHTML = '';
    rows.forEach(function (p) { list.appendChild(card(p)); });
  }

  // ── Events moderation ──
  async function loadEvents() {
    $('bz-queue-sub').textContent = eventFilter === 'hidden' ? 'Hidden events (not shown in the app).'
      : (eventFilter === 'live' ? 'Live events — auto-approved and visible in the app.' : 'All events.');
    Array.prototype.forEach.call(document.querySelectorAll('[data-efilter]'), function (b) {
      b.classList.toggle('bz-filter-active', b.getAttribute('data-efilter') === eventFilter);
    });
    var q = sb.from('venue_events').select('*, smoking_places(name,city)').order('starts_at', { ascending: false });
    if (eventFilter === 'live') q = q.eq('status', 'approved');
    else if (eventFilter === 'hidden') q = q.eq('status', 'hidden');
    var res = await q;
    if (res.error) {
      $('bz-list').innerHTML = '<div class="bz-empty">' +
        (/venue_events/i.test(res.error.message || '') ? 'Run the events SQL migration (03_venue_events.sql) in Supabase first.' : 'Error: ' + res.error.message) +
        '</div>';
      return;
    }
    rowsCache = res.data || [];
    renderList();
  }
  function renderEventList() {
    var list = $('bz-list');
    var rows = rowsCache.filter(function (e) {
      if (!query) return true;
      var vn = e.smoking_places ? e.smoking_places.name : '';
      return [e.title, vn, e.description].filter(Boolean).join(' ').toLowerCase().indexOf(query) !== -1;
    });
    if (!rows.length) { list.innerHTML = '<div class="bz-empty">No events here.</div>'; return; }
    list.innerHTML = '';
    rows.forEach(function (e) { list.appendChild(eventCard(e)); });
  }
  function eventCard(e) {
    var el = document.createElement('div'); el.className = 'bz-card';
    var vn = e.smoking_places ? (e.smoking_places.name || '') : '';
    var vc = e.smoking_places ? (e.smoking_places.city || '') : '';
    var rec = (e.recurrence && e.recurrence !== 'none') ? REC_LABELS[e.recurrence] : '';
    var badgeKind = e.status === 'approved' ? 'approved' : (e.status === 'hidden' ? 'hidden' : 'pending');
    var badgeText = e.status === 'approved' ? 'Live' : (e.status === 'hidden' ? 'Hidden' : (STATUS_LABELS[e.status] || e.status));
    el.innerHTML =
      '<div style="display:flex;gap:14px;align-items:flex-start">' +
        (e.image_url ? '<div class="bz-slot filled" style="width:88px;height:88px;flex:0 0 auto"><img src="' + e.image_url + '" alt=""></div>' : '') +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">' +
            '<div><div class="bz-place-name" style="font-size:18px"></div>' +
            '<div class="bz-place-meta">' + (vn ? escapeHtml(vn) : '—') + (vc ? ' · ' + escapeHtml(vc) : '') + ' · ' + escapeHtml(fmtDate(e.starts_at)) + (rec ? ' · ' + rec : '') + '</div></div>' +
            '<span class="bz-badge ' + badgeKind + '">' + badgeText + '</span>' +
          '</div>' +
          (e.description ? '<p style="color:var(--text-secondary);font-size:14px;white-space:pre-line;margin:10px 0 0">' + escapeHtml(e.description) + '</p>' : '') +
          '<div class="bz-actions" style="margin-top:12px"></div>' +
        '</div>' +
      '</div>';
    el.querySelector('.bz-place-name').textContent = e.title;
    var actions = el.querySelector('.bz-actions');
    if (e.status === 'hidden') actions.appendChild(btn('Restore to live', 'bz-btn bz-btn-sm', function () { setEventStatus(e.id, 'approved'); }));
    else actions.appendChild(btn('Hide from app', 'bz-btn bz-btn-ghost bz-btn-sm', function () { setEventStatus(e.id, 'hidden'); }));
    actions.appendChild(btn('Delete', 'bz-btn bz-btn-danger bz-btn-sm', function () { if (confirm('Delete "' + e.title + '"? This cannot be undone.')) delEvent(e.id); }));
    return el;
  }
  async function setEventStatus(id, status) {
    var res = await sb.from('venue_events').update({ status: status }).eq('id', id);
    if (res.error) { alert('Error: ' + res.error.message); return; } load();
  }
  async function delEvent(id) {
    var res = await sb.from('venue_events').delete().eq('id', id);
    if (res.error) { alert('Error: ' + res.error.message); return; } load();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function card(p) {
    var el = document.createElement('div'); el.className = 'bz-card';
    var imgs = [].concat(p.gallery_urls || []).filter(Boolean).slice(0, 8)
      .map(function (u) { return '<div class="bz-slot filled" style="aspect-ratio:1"><img src="' + u + '" alt=""></div>'; }).join('');
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:start">' +
        '<div><div class="bz-place-name" style="font-size:18px"></div>' +
        '<div class="bz-place-meta">' + (TYPE_LABELS[p.type] || p.type) + ' · ' + (p.city || '') + ' · ' + escapeHtml(p.address || '') + '</div></div>' +
        '<span class="bz-badge ' + p.status + '">' + (STATUS_LABELS[p.status] || p.status) + '</span></div>' +
      (p.description ? '<p style="color:var(--text-secondary);font-size:14px;white-space:pre-line;margin:10px 0 0">' + escapeHtml(p.description) + '</p>' : '') +
      (p.moderation_note ? '<div class="bz-review-note"><strong>Note to owner</strong><p>' + escapeHtml(p.moderation_note) + '</p></div>' : '') +
      (p.website_url ? '<p style="margin:6px 0 0"><a href="' + p.website_url + '" target="_blank" rel="noopener">' + escapeHtml(p.website_url) + '</a></p>' : '') +
      '<div class="bz-slots" style="margin-top:12px">' + imgs + '</div>' +
      '<div class="bz-manager-box"><p class="bz-section-label">Managers</p><div class="bz-manager-list">Loading managers…</div></div>' +
      '<div class="bz-actions"></div>';
    el.querySelector('.bz-place-name').textContent = p.name;
    loadManagers(p.id, el.querySelector('.bz-manager-box'));
    var actions = el.querySelector('.bz-actions');
    if (p.status !== 'approved') actions.appendChild(btn('Approve', 'bz-btn bz-btn-sm', function () { setStatus(p.id, 'approved'); }));
    actions.appendChild(btn('Edit details', 'bz-btn bz-btn-ghost bz-btn-sm', function () { toggleEditor(el, p); }));
    if (p.status !== 'hidden') actions.appendChild(btn('Request changes', 'bz-btn bz-btn-ghost bz-btn-sm', function () { toggleRequestChanges(el, p); }));
    if (p.status === 'hidden') actions.appendChild(btn('Back to review', 'bz-btn bz-btn-ghost bz-btn-sm', function () { setStatus(p.id, 'pending', { moderation_note: null }); }));
    actions.appendChild(btn('Delete', 'bz-btn bz-btn-danger bz-btn-sm', function () { if (confirm('Delete "' + p.name + '"?')) del(p.id); }));
    return el;
  }
  function btn(label, cls, fn) { var b = document.createElement('button'); b.className = cls; b.textContent = label; b.addEventListener('click', fn); return b; }

  async function loadManagers(placeId, box) {
    var list = box.querySelector('.bz-manager-list');
    var res = await sb.from('smoking_place_managers').select('id,email,role,status,user_id,created_at')
      .eq('place_id', placeId).neq('status', 'revoked').order('created_at', { ascending: true });
    if (res.error) {
      list.innerHTML = '<p class="bz-manager-empty">Run the managers SQL migration to enable access management.</p>';
      renderManagerForm(placeId, box, []);
      return;
    }
    var rows = res.data || [];
    renderManagerList(placeId, list, rows);
    renderManagerForm(placeId, box, rows);
  }

  function renderManagerList(placeId, list, rows) {
    if (!rows.length) {
      list.innerHTML = '<p class="bz-manager-empty">No extra managers yet. The original owner still has access if set.</p>';
      return;
    }
    list.innerHTML = '';
    rows.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'bz-manager-row';
      row.innerHTML =
        '<div><strong>' + escapeHtml(m.email) + '</strong><span>' + escapeHtml(m.role) + ' · ' + escapeHtml(m.status) + (m.user_id ? ' · linked account' : ' · waiting for magic-link sign-in') + '</span></div>' +
        '<button class="bz-btn bz-btn-ghost bz-btn-sm">Remove</button>';
      row.querySelector('button').addEventListener('click', function () {
        if (confirm('Remove access for ' + m.email + '?')) removeManager(m.id, placeId, list.closest('.bz-manager-box'));
      });
      list.appendChild(row);
    });
  }

  function renderManagerForm(placeId, box, rows) {
    var old = box.querySelector('.bz-manager-form');
    if (old) old.remove();
    var form = document.createElement('div');
    form.className = 'bz-manager-form';
    form.innerHTML =
      '<input class="bz-input m-email" type="email" placeholder="owner@email.com">' +
      '<select class="bz-select m-role"><option value="manager">Manager</option><option value="owner">Owner</option></select>' +
      '<button class="bz-btn bz-btn-sm m-add">Add access</button>' +
      '<div class="bz-msg m-msg"></div>';
    form.querySelector('.m-add').addEventListener('click', function () { addManager(placeId, form, this); });
    box.appendChild(form);
  }

  async function addManager(placeId, form, button) {
    var email = form.querySelector('.m-email').value.trim();
    var role = form.querySelector('.m-role').value;
    if (!email) { inlineManagerMsg(form, 'Enter an email first.', 'err'); return; }
    button.disabled = true; button.textContent = 'Adding...';
    var res = await sb.rpc('admin_assign_place_manager', { place: placeId, manager_email: email, manager_role: role });
    button.disabled = false; button.textContent = 'Add access';
    if (res.error) { inlineManagerMsg(form, 'Error: ' + res.error.message, 'err'); return; }
    form.querySelector('.m-email').value = '';
    inlineManagerMsg(form, 'Access added.', 'ok');
    await loadManagers(placeId, form.closest('.bz-manager-box'));
  }

  async function removeManager(managerId, placeId, box) {
    var res = await sb.rpc('admin_remove_place_manager', { manager_id: managerId });
    if (res.error) { alert('Error: ' + res.error.message); return; }
    await loadManagers(placeId, box);
  }

  function inlineManagerMsg(form, text, kind) {
    var m = form.querySelector('.m-msg');
    m.textContent = text;
    m.className = 'bz-msg m-msg show ' + kind;
  }

  function toggleRequestChanges(cardEl, p) {
    var existing = cardEl.querySelector('.bz-request-changes');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'bz-admin-edit bz-request-changes';
    form.innerHTML =
      '<p class="bz-section-label">Request changes</p>' +
      '<div class="bz-field">' +
        '<label class="bz-label">Message for the owner</label>' +
        '<textarea class="bz-textarea e-note" placeholder="Example: Please upload brighter photos of the interior and clarify whether guests can bring their own cigars."></textarea>' +
      '</div>' +
      '<div class="bz-msg e-msg"></div>' +
      '<div class="bz-actions">' +
        '<button class="bz-btn bz-btn-sm e-send">Send back to owner</button>' +
        '<button class="bz-btn bz-btn-ghost bz-btn-sm e-cancel">Cancel</button>' +
      '</div>';
    form.querySelector('.e-note').value = p.moderation_note || '';
    form.querySelector('.e-cancel').addEventListener('click', function () { form.remove(); });
    form.querySelector('.e-send').addEventListener('click', function () { requestChanges(p.id, form, this); });
    cardEl.appendChild(form);
  }

  async function requestChanges(id, form, button) {
    var note = form.querySelector('.e-note').value.trim();
    if (!note) { inlineMsg(form, 'Write a short note for the owner first.', 'err'); return; }
    button.disabled = true; button.textContent = 'Sending...';
    var res = await sb.from('smoking_places').update({
      status: 'hidden',
      moderation_note: note,
      moderated_at: new Date().toISOString()
    }).eq('id', id);
    button.disabled = false; button.textContent = 'Send back to owner';
    if (res.error) { inlineMsg(form, 'Error: ' + res.error.message, 'err'); return; }
    await load();
  }

  function toggleEditor(cardEl, p) {
    var existing = cardEl.querySelector('.bz-admin-edit');
    if (existing) { existing.remove(); return; }
    var form = document.createElement('div');
    form.className = 'bz-admin-edit';
    form.innerHTML =
      '<p class="bz-section-label">Admin edit</p>' +
      '<div class="bz-admin-edit-grid">' +
        '<div class="bz-field"><label class="bz-label">Venue name</label><input class="bz-input e-name" type="text"></div>' +
        '<div class="bz-field"><label class="bz-label">Type</label><select class="bz-select e-type">' +
          '<option value="lounge">Lounge</option><option value="bar">Bar</option><option value="shop">Shop</option><option value="restaurant">Restaurant</option><option value="outdoor">Outdoor</option>' +
        '</select></div>' +
        '<div class="bz-field"><label class="bz-label">City</label><input class="bz-input e-city" type="text"></div>' +
        '<div class="bz-field"><label class="bz-label">Address</label><input class="bz-input e-address" type="text"></div>' +
      '</div>' +
      '<div class="bz-field"><label class="bz-label">Website</label><input class="bz-input e-web" type="url"></div>' +
      '<div class="bz-field"><label class="bz-label">Description</label><textarea class="bz-textarea e-description"></textarea></div>' +
      '<div class="bz-msg e-msg"></div>' +
      '<div class="bz-actions">' +
        '<button class="bz-btn bz-btn-sm e-save">Save admin edits</button>' +
        '<button class="bz-btn bz-btn-ghost bz-btn-sm e-cancel">Cancel</button>' +
      '</div>';
    form.querySelector('.e-name').value = p.name || '';
    form.querySelector('.e-type').value = p.type || 'lounge';
    form.querySelector('.e-city').value = p.city || '';
    form.querySelector('.e-address').value = p.address || '';
    form.querySelector('.e-web').value = p.website_url || '';
    form.querySelector('.e-description').value = p.description || '';
    form.querySelector('.e-cancel').addEventListener('click', function () { form.remove(); });
    form.querySelector('.e-save').addEventListener('click', function () { saveEdits(p.id, form, this); });
    cardEl.appendChild(form);
  }

  async function saveEdits(id, form, button) {
    var payload = {
      name: form.querySelector('.e-name').value.trim(),
      type: form.querySelector('.e-type').value,
      city: form.querySelector('.e-city').value.trim(),
      address: form.querySelector('.e-address').value.trim(),
      website_url: form.querySelector('.e-web').value.trim() || null,
      description: form.querySelector('.e-description').value.trim(),
      moderated_at: new Date().toISOString()
    };
    if (!payload.name || !payload.city || !payload.address) {
      inlineMsg(form, 'Name, city and address are required.', 'err');
      return;
    }
    button.disabled = true; button.textContent = 'Saving...';
    var res = await sb.from('smoking_places').update(payload).eq('id', id);
    button.disabled = false; button.textContent = 'Save admin edits';
    if (res.error) { inlineMsg(form, 'Error: ' + res.error.message, 'err'); return; }
    await load();
  }

  function inlineMsg(form, text, kind) {
    var m = form.querySelector('.e-msg');
    m.textContent = text;
    m.className = 'bz-msg e-msg show ' + kind;
  }

  async function setStatus(id, status, extra) {
    var payload = Object.assign({ status: status, moderated_at: new Date().toISOString() }, extra || {});
    if (status === 'approved') payload.moderation_note = null;
    var res = await sb.from('smoking_places').update(payload).eq('id', id);
    if (res.error) { alert('Error: ' + res.error.message); return; } load();
  }
  async function del(id) {
    var res = await sb.from('smoking_places').delete().eq('id', id);
    if (res.error) { alert('Error: ' + res.error.message); return; } load();
  }

  init();
})();
