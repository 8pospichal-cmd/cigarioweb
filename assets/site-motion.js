(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function enhanceNav() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    var toggle = document.getElementById('nav-toggle');
    var dropdown = document.getElementById('nav-dropdown');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'nav-hamburger';
      toggle.id = 'nav-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Open menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span></span><span></span><span></span>';
      nav.appendChild(toggle);
    }
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'nav-dropdown';
      dropdown.id = 'nav-dropdown';
      var links = nav.querySelectorAll('.nav-links a');
      Array.prototype.forEach.call(links, function (link) {
        var a = link.cloneNode(true);
        a.className = link.classList.contains('nav-business-link') ? 'nav-dropdown-item nav-dropdown-business' : 'nav-dropdown-item';
        dropdown.appendChild(a);
      });
      nav.insertAdjacentElement('afterend', dropdown);
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dropdown.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && !toggle.contains(e.target)) {
        dropdown.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    dropdown.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        dropdown.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  function revealContent() {
    var nodes = document.querySelectorAll(
      '.legal-header, .legal-content > *, .support-card, .info-box, footer'
    );
    Array.prototype.forEach.call(nodes, function (el, i) {
      if (!el.classList.contains('reveal')) el.classList.add('reveal');
      if (!el.style.getPropertyValue('--delay')) el.style.setProperty('--delay', Math.min(i * 45, 260) + 'ms');
    });
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(nodes, function (el) { el.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.04, rootMargin: '0px 0px -24px 0px' });
    Array.prototype.forEach.call(nodes, function (el) { observer.observe(el); });
  }

  ready(function () {
    enhanceNav();
    revealContent();
  });
})();
