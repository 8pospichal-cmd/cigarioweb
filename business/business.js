/* Cigario Business — owner portal logic (vanilla JS, English) */
(function () {
  var sb = window.sb;
  var DAYS = [
    ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'],
    ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday'],
  ];
  var TYPE_LABELS = { lounge: 'Lounge', bar: 'Bar', shop: 'Shop', restaurant: 'Restaurant', outdoor: 'Outdoor' };
  var STATUS_LABELS = { approved: 'Approved', pending: 'Pending review', draft: 'Draft', hidden: 'Edits needed' };
  var STATUS_HELP = {
    approved: 'Live in the Cigario app. Any edit will be submitted for review again.',
    pending: 'Waiting for Cigario to review it before it goes live.',
    draft: 'Saved as draft.',
    hidden: 'Cigario requested changes. Edit the venue and submit it again for review.'
  };
  var SLOTS = 4;

  // 30-minute time options 00:00 … 23:30
  var TIME_OPTS = (function () {
    var out = [];
    for (var h = 0; h < 24; h++) for (var m = 0; m < 60; m += 30)
      out.push((h < 10 ? '0' + h : h) + ':' + (m === 0 ? '00' : '30'));
    return out;
  })();

  var user = null, editingId = null, editingOwnerId = null, isAdmin = false;
  var photos = [null, null, null, null];
  var currentSlot = null;
  var map = null, marker = null, pin = { lat: null, lng: null };
  var fileInput, autosaveTimer = null, isRestoringDraft = false;

  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
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
  function openAuthModal(pushHash) {
    var modal = $('bz-auth-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.classList.add('bz-modal-open');
    modal.setAttribute('aria-hidden', 'false');
    if (pushHash && window.location.hash !== '#bz-owner-login') {
      history.pushState(null, '', '#bz-owner-login');
    }
    setTimeout(function () {
      var btn = $('bz-send');
      if (btn) btn.focus();
    }, 80);
  }
  function closeAuthModal(clearHash) {
    var modal = $('bz-auth-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('bz-modal-open');
    modal.setAttribute('aria-hidden', 'true');
    if (clearHash && window.location.hash === '#bz-owner-login') {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }
  function bindAuthModal() {
    var modal = $('bz-auth-modal');
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(document.querySelectorAll('[data-auth-modal]'), function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openAuthModal(true);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-auth-close]'), function (el) {
      el.addEventListener('click', function () { closeAuthModal(true); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeAuthModal(true);
    });
    window.addEventListener('hashchange', function () {
      if (window.location.hash === '#bz-owner-login' && !user) openAuthModal(false);
    });
  }
  function msg(el, t, k) { var m = $(el); m.textContent = t; m.className = 'bz-msg show ' + (k || ''); }
  function clearMsg(el) { $(el).className = 'bz-msg'; }
  function view(w) { ['bz-auth', 'bz-dash', 'bz-form'].forEach(hide); show('bz-' + w); }
  function draftKey() { return user ? 'cigario-business-draft:' + user.id + ':' + (editingId || 'new') : null; }
  function initPublicMotion() {
    var items = document.querySelectorAll(
      '.bz-hero-copy, .bz-hero-panel, .bz-section-head, .bz-feature, .bz-step, .bz-auth-card, .bz-info-card, .bz-verified-panel'
    );
    Array.prototype.forEach.call(items, function (el, i) {
      if (!el.classList.contains('bz-reveal')) el.classList.add('bz-reveal');
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(i % 6));
    });
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(items, function (el) { el.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.04, rootMargin: '0px 0px -20px 0px' });
    Array.prototype.forEach.call(items, function (el) {
      if (!el.dataset.motionObserved) {
        el.dataset.motionObserved = '1';
        observer.observe(el);
      }
    });
  }

  function setupHeroParallax() {
    var stage = document.querySelector('.bz-hero-stage');
    var hero = document.querySelector('.bz-hero');
    if (!stage || !hero) return;
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (!window.matchMedia('(pointer: fine)').matches) return;
    }
    var layers = Array.prototype.slice.call(stage.querySelectorAll('[data-depth]'));
    if (!layers.length) return;
    var tx = 0, ty = 0, raf = null;
    function apply() {
      raf = null;
      layers.forEach(function (el) {
        var d = parseFloat(el.getAttribute('data-depth')) || 0;
        el.style.transform = 'translate3d(' + (tx * d).toFixed(1) + 'px,' + (ty * d).toFixed(1) + 'px,0)';
      });
    }
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (0.5 - (e.clientX - r.left) / r.width) * 2;
      ty = (0.5 - (e.clientY - r.top) / r.height) * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(apply); });
  }

  // ── Auth ──
  async function init() {
    fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
    fileInput.addEventListener('change', onFilePicked);
    document.body.appendChild(fileInput);
    bindAutosave();
    bindProfileMenu();
    bindAuthModal();
    setupHeroParallax();

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
    Array.prototype.forEach.call(document.querySelectorAll('.bz-tab-admin'), function (el) {
      el.classList.toggle('hidden', !on);
    });
  }
  async function setUser(u) {
    user = u;
    if (user) {
      closeAuthModal(true);
      showPublicNav(false);
      $('bz-userline').textContent = user.email || ''; show('bz-profile-menu'); show('bz-nav'); show('bz-sidebar'); setProfileMenu(false);
      var r = await sb.rpc('is_admin');
      isAdmin = !!(r && r.data === true);
      setAdminTabs(isAdmin);
      view('dash'); loadPlaces();
    } else {
      showPublicNav(true);
      hide('bz-profile-menu'); hide('bz-nav'); hide('bz-sidebar'); setProfileMenu(false); isAdmin = false; view('auth');
      initPublicMotion();
      if (window.location.hash === '#bz-owner-login') openAuthModal(false);
    }
  }
  $('bz-send').addEventListener('click', async function () {
    this.disabled = true; this.textContent = 'Opening Google...';
    var res = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/business/' }
    });
    if (res.error) {
      this.disabled = false; this.textContent = 'Continue with Google';
      msg('bz-auth-msg', 'Error: ' + res.error.message, 'err');
    }
  });
  $('bz-signout').addEventListener('click', async function (e) { e.preventDefault(); await sb.auth.signOut(); });

  // ── Dashboard ──
  async function loadPlaces() {
    var box = $('bz-places'); box.innerHTML = '<div class="bz-empty">Loading…</div>';
    var res = await sb.rpc('get_my_business_places');
    if (res.error && /get_my_business_places/i.test(res.error.message || '')) {
      res = await sb.from('smoking_places').select('id,name,type,city,address,status,moderation_note,photo_url,gallery_urls,description,website_url,owner_user_id,submitted_at')
        .eq('owner_user_id', user.id).order('submitted_at', { ascending: false });
    }
    if (res.error) { box.innerHTML = '<div class="bz-empty">Error: ' + res.error.message + '</div>'; return; }
    var rows = res.data || [];
    updateStats(rows);
    if (!rows.length) {
      box.innerHTML =
        '<div class="bz-empty-card">' +
          '<p class="bz-eyebrow">Start here</p>' +
          '<h2>Add your first venue</h2>' +
          '<p>Submit the address, map pin, opening hours, cigar conditions and four strong photos. Cigario reviews every listing before it appears in the app.</p>' +
          '<button class="bz-btn" type="button" id="bz-empty-add">Add venue</button>' +
        '</div>';
      $('bz-empty-add').addEventListener('click', function () { openForm(null); });
      return;
    }
    box.innerHTML = '';
    rows.forEach(function (p) {
      var st = p.status || 'pending';
      var el = document.createElement('div'); el.className = 'bz-place bz-place-' + st;
      var gallery = [].concat(p.gallery_urls || []).filter(Boolean);
      if (p.photo_url && gallery.indexOf(p.photo_url) === -1) gallery.unshift(p.photo_url);
      var heroPhoto = gallery[0] || '';
      var thumbPhotos = gallery.slice(1, 4).map(function (url) {
        return '<img class="bz-place-thumb-small" src="' + url + '" alt="">';
      }).join('');
      el.innerHTML =
        '<div class="bz-place-media">' +
          (heroPhoto ? '<img class="bz-place-hero-photo" src="' + heroPhoto + '" alt="">' : '<div class="bz-place-hero-photo bz-place-photo-empty"></div>') +
          '<div class="bz-place-thumbs">' + thumbPhotos + '</div>' +
        '</div>' +
        '<div class="bz-place-body">' +
          '<div class="bz-place-topline">' +
            '<span class="bz-badge status-' + st + '">' + (STATUS_LABELS[st] || st) + '</span>' +
            '<span class="bz-place-edit-hint">Edit listing</span>' +
          '</div>' +
          '<div class="bz-place-name"></div>' +
          '<div class="bz-place-meta bz-place-kind">' + (TYPE_LABELS[p.type] || p.type) + ' · ' + (p.city || '') + '</div>' +
          (p.address ? '<div class="bz-place-meta bz-place-address">' + escapeHtml(p.address) + '</div>' : '') +
          '<p class="bz-place-desc">' + escapeHtml(p.description || 'No description yet.') + '</p>' +
          (p.moderation_note ? '<div class="bz-review-note"><strong>Cigario note</strong><p>' + escapeHtml(p.moderation_note) + '</p></div>' : '') +
          (p.website_url ? '<div class="bz-place-web">' + escapeHtml(p.website_url) + '</div>' : '') +
          '<div class="bz-place-status-note">' + (STATUS_HELP[st] || '') + '</div>' +
        '</div>';
      el.querySelector('.bz-place-name').textContent = p.name;
      el.addEventListener('click', function () { openForm(p.id); });
      box.appendChild(el);
    });
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function setNote(id, text, kind) {
    var el = $(id); if (!el) return;
    el.textContent = text; el.className = 'bz-stat-note ' + (kind || 'is-muted');
  }
  function updateStats(rows) {
    var total = rows.length;
    var pending = rows.filter(function (p) { return (p.status || 'pending') === 'pending'; }).length;
    var approved = rows.filter(function (p) { return p.status === 'approved'; }).length;
    $('bz-stat-total').textContent = total;
    $('bz-stat-pending').textContent = pending;
    $('bz-stat-approved').textContent = approved;

    var now = new Date();
    var addedThisMonth = rows.filter(function (p) {
      if (!p.submitted_at) return false;
      var d = new Date(p.submitted_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
    setNote('bz-stat-total-note',
      addedThisMonth > 0 ? '+' + addedThisMonth + ' this month' : 'No new this month',
      addedThisMonth > 0 ? 'is-ok' : 'is-muted');
    setNote('bz-stat-pending-note',
      pending > 0 ? 'Review now' : 'All reviewed',
      pending > 0 ? 'is-warn' : 'is-ok');
    var pct = total > 0 ? Math.round(approved / total * 100) : 0;
    setNote('bz-stat-approved-note',
      total > 0 ? pct + '% of total' : '—',
      total > 0 ? 'is-ok' : 'is-muted');
  }
  $('bz-add').addEventListener('click', function () { openForm(null); });
  $('f-cancel').addEventListener('click', function () { view('dash'); loadPlaces(); });

  function bindAutosave() {
    var ids = ['f-name', 'f-type', 'f-city', 'f-address', 'f-web', 'f-q1', 'f-q2', 'f-q3', 'f-confirm'];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', onFormChanged);
      if (el) el.addEventListener('change', onFormChanged);
    });
    $('f-hours').addEventListener('change', onFormChanged);
  }
  function onFormChanged() {
    updateChecklist();
    scheduleAutosave();
  }
  function scheduleAutosave() {
    if (isRestoringDraft || !user) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    $('bz-autosave-status').textContent = 'Saving draft...';
    autosaveTimer = setTimeout(saveLocalDraft, 450);
  }
  function collectDraft() {
    return {
      name: $('f-name').value, type: $('f-type').value, city: $('f-city').value, address: $('f-address').value,
      web: $('f-web').value, q1: $('f-q1').value, q2: $('f-q2').value, q3: $('f-q3').value,
      confirm: $('f-confirm').checked, photos: photos, pin: pin, hours: collectHours(), savedAt: new Date().toISOString()
    };
  }
  function saveLocalDraft() {
    var key = draftKey(); if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(collectDraft()));
      $('bz-autosave-status').textContent = 'Draft saved locally';
    } catch (e) {
      $('bz-autosave-status').textContent = 'Draft could not be saved';
    }
  }
  function clearLocalDraft() {
    var key = draftKey(); if (key) localStorage.removeItem(key);
  }
  function restoreLocalDraft() {
    var key = draftKey(); if (!key) return false;
    var raw = localStorage.getItem(key); if (!raw) return false;
    try {
      var d = JSON.parse(raw);
      if (!d) return false;
      isRestoringDraft = true;
      $('f-name').value = d.name || ''; $('f-type').value = d.type || 'lounge';
      $('f-city').value = d.city || ''; $('f-address').value = d.address || ''; $('f-web').value = d.web || '';
      $('f-q1').value = d.q1 || ''; $('f-q2').value = d.q2 || ''; $('f-q3').value = d.q3 || '';
      $('f-confirm').checked = !!d.confirm;
      photos = Array.isArray(d.photos) ? d.photos.slice(0, SLOTS).concat([null, null, null, null]).slice(0, SLOTS) : photos;
      if (d.hours) buildHours(d.hours);
      renderSlots();
      if (d.pin && d.pin.lat != null && d.pin.lng != null) setPin(d.pin.lat, d.pin.lng, true);
      $('bz-autosave-status').textContent = 'Draft restored';
      isRestoringDraft = false;
      updateChecklist();
      return true;
    } catch (e) {
      isRestoringDraft = false;
      return false;
    }
  }

  // ── Hours ──
  function timeSelect(cls, val) {
    var s = '<select class="bz-select ' + cls + '">';
    TIME_OPTS.forEach(function (t) { s += '<option' + (t === val ? ' selected' : '') + '>' + t + '</option>'; });
    return s + '</select>';
  }
  function buildHours(prefill) {
    var wrap = $('f-hours'); wrap.innerHTML = '';
    DAYS.forEach(function (d) {
      var v = prefill && prefill[d[0]];
      var closed = v === 'closed' || v === null;
      var from = '10:00', to = '22:00';
      if (v && typeof v === 'string' && v !== 'closed') {
        var parts = v.split(/[-–—]/); if (parts.length === 2) { from = parts[0].trim(); to = parts[1].trim(); }
      }
      var row = document.createElement('div');
      row.className = 'bz-hours-row' + (closed ? ' is-closed' : ''); row.setAttribute('data-day', d[0]);
      row.innerHTML =
        '<span class="day">' + d[1] + '</span>' +
        '<label class="bz-closed"><input type="checkbox" class="h-closed"' + (closed ? ' checked' : '') + '> Closed</label>' +
        timeSelect('h-from', from) + '<span class="dash">–</span>' + timeSelect('h-to', to);
      var cb = row.querySelector('.h-closed');
      cb.addEventListener('change', function () { row.classList.toggle('is-closed', cb.checked); });
      wrap.appendChild(row);
    });
    updateChecklist();
  }
  $('f-sync').addEventListener('click', function () {
    var rows = $('f-hours').querySelectorAll('.bz-hours-row');
    if (!rows.length) return;
    var first = rows[0];
    var closed = first.querySelector('.h-closed').checked;
    var from = first.querySelector('.h-from').value, to = first.querySelector('.h-to').value;
    rows.forEach(function (r) {
      r.querySelector('.h-closed').checked = closed; r.classList.toggle('is-closed', closed);
      r.querySelector('.h-from').value = from; r.querySelector('.h-to').value = to;
    });
    onFormChanged();
  });
  function collectHours() {
    var hours = {};
    $('f-hours').querySelectorAll('.bz-hours-row').forEach(function (r) {
      var day = r.getAttribute('data-day');
      hours[day] = r.querySelector('.h-closed').checked ? 'closed' : (r.querySelector('.h-from').value + '-' + r.querySelector('.h-to').value);
    });
    return hours;
  }

  // ── Photo slots ──
  function renderSlots() {
    var wrap = $('bz-slots'); wrap.innerHTML = '';
    for (var i = 0; i < SLOTS; i++) {
      (function (i) {
        var slot = document.createElement('div');
        slot.className = 'bz-slot' + (photos[i] ? ' filled' : '');
        if (photos[i]) {
          slot.innerHTML = '<img src="' + photos[i] + '" alt=""><button class="bz-slot-del" title="Remove">×</button>';
          slot.querySelector('.bz-slot-del').addEventListener('click', function (e) {
            e.stopPropagation(); photos[i] = null; renderSlots(); onFormChanged();
          });
        } else {
          slot.innerHTML = '<span class="bz-slot-plus">+</span><span class="bz-slot-label">Photo ' + (i + 1) + '</span>';
          slot.addEventListener('click', function () { currentSlot = i; fileInput.value = ''; fileInput.click(); });
        }
        wrap.appendChild(slot);
      })(i);
    }
  }
  function resizeImage(file, maxSize) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        if (Math.max(w, h) > maxSize) { var s = maxSize / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.85);
      };
      img.src = URL.createObjectURL(file);
    });
  }
  async function onFilePicked() {
    var file = this.files && this.files[0]; if (!file || currentSlot == null) return;
    var idx = currentSlot;
    var slotEl = $('bz-slots').children[idx]; if (slotEl) slotEl.classList.add('uploading');
    try {
      var blob = await resizeImage(file, 1600);
      var path = user.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.jpg';
      var up = await sb.storage.from('place-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) { msg('bz-form-msg', 'Upload error: ' + up.error.message, 'err'); }
      else { photos[idx] = sb.storage.from('place-photos').getPublicUrl(path).data.publicUrl; clearMsg('bz-form-msg'); }
    } catch (e) { msg('bz-form-msg', 'Could not process the image.', 'err'); }
    renderSlots();
    onFormChanged();
  }

  // ── Open form ──
  async function openForm(id) {
    editingId = id; editingOwnerId = null; photos = [null, null, null, null]; pin = { lat: null, lng: null };
    clearMsg('bz-form-msg');
    $('f-name').value = ''; $('f-city').value = ''; $('f-address').value = '';
    $('f-web').value = ''; $('f-type').value = 'lounge';
    $('f-q1').value = ''; $('f-q2').value = ''; $('f-q3').value = '';
    $('f-confirm').checked = false;
    $('bz-autosave-status').textContent = 'Draft not saved yet';
    buildHours(null); renderSlots();
    $('f-delete').classList.add('hidden');
    $('bz-form-title').textContent = id ? 'Edit venue' : 'New venue';
    $('bz-form-sub').textContent = id
      ? 'Update the details and submit the latest version for review. Approved venues temporarily return to review after saving.'
      : 'Fill in everything, add 4 photos, and submit. We\'ll review it before it goes live.';
    view('form'); initMap();
    if (marker) { map.removeLayer(marker); marker = null; }
    if (!id) map.setView([50.08, 14.42], 12);

    if (id) {
      var res = await sb.from('smoking_places').select('*').eq('id', id).single();
      if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
      var p = res.data;
      $('f-name').value = p.name || ''; $('f-city').value = p.city || '';
      $('f-address').value = p.address || ''; $('f-web').value = p.website_url || ''; $('f-type').value = p.type || 'lounge';
      var parts = (p.description || '').split(/\n\n+/);
      $('f-q1').value = parts[0] || ''; $('f-q2').value = parts[1] || ''; $('f-q3').value = parts.slice(2).join('\n\n') || '';
      buildHours(p.opening_hours || null);
      var gal = [].concat(p.gallery_urls || []).filter(Boolean);
      if (p.photo_url && gal.indexOf(p.photo_url) === -1) gal.unshift(p.photo_url);
      for (var i = 0; i < SLOTS; i++) photos[i] = gal[i] || null;
      renderSlots();
      if (p.latitude && p.longitude) setPin(p.latitude, p.longitude, true);
      $('f-confirm').checked = true; // already submitted before
      editingOwnerId = p.owner_user_id || null;
      if (editingOwnerId === user.id) $('f-delete').classList.remove('hidden');
      restoreLocalDraft();
    }
    if (!id) restoreLocalDraft();
    updateChecklist();
  }

  // ── Map ──
  function initMap() {
    if (!map) {
      map = L.map('bz-map').setView([50.08, 14.42], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      map.on('click', function (e) { setPin(e.latlng.lat, e.latlng.lng); });
    }
    setTimeout(function () { map.invalidateSize(); }, 80);
  }
  function setPin(lat, lng, center) {
    pin = { lat: lat, lng: lng };
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', function () { var ll = marker.getLatLng(); pin = { lat: ll.lat, lng: ll.lng }; });
    } else marker.setLatLng([lat, lng]);
    if (center) map.setView([lat, lng], 16);
    onFormChanged();
  }
  $('f-locate').addEventListener('click', async function () {
    var q = [$('f-address').value, $('f-city').value].filter(Boolean).join(', ');
    if (!q) { msg('bz-form-msg', 'Enter the address and city first.', 'err'); return; }
    this.disabled = true; this.textContent = 'Searching…';
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
      var j = await r.json();
      if (j && j.length) { setPin(parseFloat(j[0].lat), parseFloat(j[0].lon), true); clearMsg('bz-form-msg'); }
      else msg('bz-form-msg', 'Address not found — drop the pin on the map manually.', 'err');
    } catch (e) { msg('bz-form-msg', 'Error while searching the address.', 'err'); }
    this.disabled = false; this.textContent = 'Find on map';
  });

  // ── Save ──
  $('f-save').addEventListener('click', async function () {
    var name = $('f-name').value.trim(), city = $('f-city').value.trim(), address = $('f-address').value.trim();
    var q1 = $('f-q1').value.trim(), q2 = $('f-q2').value.trim(), q3 = $('f-q3').value.trim();
    if (!name || !city || !address) { msg('bz-form-msg', 'Please fill in the name, city and address.', 'err'); return; }
    if (!q1 || !q2 || !q3) { msg('bz-form-msg', 'Please answer all three questions.', 'err'); return; }
    if (pin.lat == null || pin.lng == null) { msg('bz-form-msg', 'Set the location on the map ("Find on map" or tap the map).', 'err'); return; }
    if (photos.filter(Boolean).length < SLOTS) { msg('bz-form-msg', 'Please add all 4 photos.', 'err'); return; }
    if (!$('f-confirm').checked) { msg('bz-form-msg', 'Please tick the confirmation checkbox.', 'err'); return; }

    var hours = collectHours();

    var payload = {
      name: name, type: $('f-type').value, city: city, address: address,
      latitude: pin.lat, longitude: pin.lng, website_url: $('f-web').value.trim() || null,
      description: [q1, q2, q3].join('\n\n'),
      opening_hours: hours, photo_url: photos[0], gallery_urls: photos.filter(Boolean),
      status: 'pending', submitted_at: new Date().toISOString(),
      moderation_note: null,
    };
    if (!editingId) payload.owner_user_id = user.id;
    this.disabled = true; this.textContent = 'Saving…';
    var res = editingId ? await sb.from('smoking_places').update(payload).eq('id', editingId)
                        : await sb.from('smoking_places').insert(payload);
    this.disabled = false; this.textContent = 'Save & submit for review';
    if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
    clearLocalDraft();
    view('dash'); loadPlaces();
  });

  function updateChecklist() {
    if (!$('bz-checklist')) return;
    var checks = {
      basic: !!($('f-name').value.trim() && $('f-city').value.trim() && $('f-address').value.trim()),
      location: pin.lat != null && pin.lng != null,
      description: !!($('f-q1').value.trim() && $('f-q2').value.trim() && $('f-q3').value.trim()),
      hours: $('f-hours').querySelectorAll('.bz-hours-row').length === 7,
      photos: photos.filter(Boolean).length >= SLOTS,
      confirm: $('f-confirm').checked
    };
    Object.keys(checks).forEach(function (key) {
      var el = document.querySelector('[data-check="' + key + '"]');
      if (el) el.classList.toggle('done', checks[key]);
    });
  }

  // ── Delete ──
  $('f-delete').addEventListener('click', async function () {
    if (!editingId || !confirm('Delete this venue?')) return;
    var res = await sb.from('smoking_places').delete().eq('id', editingId);
    if (res.error) { msg('bz-form-msg', 'Error: ' + res.error.message, 'err'); return; }
    clearLocalDraft();
    view('dash'); loadPlaces();
  });

  init();
})();
