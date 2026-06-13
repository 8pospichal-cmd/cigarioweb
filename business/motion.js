(function () {
  var observer = null;
  var motionSelector = [
    '.bz-page-head',
    '.bz-section-head',
    '.bz-hero-copy',
    '.bz-hero-panel',
    '.bz-feature',
    '.bz-step',
    '.bz-auth-card',
    '.bz-stat',
    '.bz-place',
    '.bz-info-card',
    '.bz-verified-panel',
    '.bz-events-hero',
    '.bz-empty-card',
    '.bz-admin-toolbar',
    '.bz-mode-toggle',
    '#bz-list > .bz-card',
    '#bz-events > *'
  ].join(',');

  function ensureObserver() {
    if (observer || !('IntersectionObserver' in window)) return observer;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.04, rootMargin: '0px 0px -24px 0px' });
    return observer;
  }

  function applyMotion(root) {
    var scope = root || document;
    var nodes = [];
    if (scope.matches && scope.matches(motionSelector)) nodes.push(scope);
    if (scope.querySelectorAll) nodes = nodes.concat(Array.prototype.slice.call(scope.querySelectorAll(motionSelector)));
    Array.prototype.forEach.call(nodes, function (el, i) {
      if (el.dataset.motionReady) return;
      el.dataset.motionReady = '1';
      el.classList.add('bz-reveal');
      if (el.classList.contains('bz-card') || el.classList.contains('bz-stat')) el.classList.add('bz-motion-card');
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', String(i % 6));
      if (!('IntersectionObserver' in window)) el.classList.add('is-visible');
      else ensureObserver().observe(el);
    });
  }

  function start() {
    applyMotion(document);
    if (!('MutationObserver' in window)) return;
    var mo = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        Array.prototype.forEach.call(m.addedNodes, function (node) {
          if (node.nodeType === 1) applyMotion(node);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
