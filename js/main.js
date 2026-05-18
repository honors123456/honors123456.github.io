(function () {
  const path = window.location.pathname;

  // Active nav state
  const navLinks = document.querySelectorAll('.nav-menu a');
  navLinks.forEach(function (link) {
    const href = link.getAttribute('href');
    if (href === './' || href === '../') {
      if (path === '/' || path.endsWith('/index.html')) {
        var segs = path.replace(/\/index\.html$/, '').split('/').filter(Boolean);
        if (segs.length === 0 && (href === './' || href === '../')) link.classList.add('active');
      }
      return;
    }
    if (path.includes(href.replace(/^\.\.?\//, '').replace(/\/$/, ''))) {
      link.classList.add('active');
    }
  });

  // Mobile menu toggle
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.querySelector('.nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !expanded);
      menu.classList.toggle('nav-menu--open');
      toggle.classList.toggle('nav-toggle--open');
    });
  }

  // Back to top
  var btn = document.querySelector('.back-to-top');
  if (btn) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          if (window.scrollY > 400) {
            btn.classList.add('back-to-top--visible');
          } else {
            btn.classList.remove('back-to-top--visible');
          }
          ticking = false;
        });
        ticking = true;
      }
    });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
})();
