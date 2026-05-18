(function () {
  var path = window.location.pathname;
  var html = document.documentElement;

  /* ================================================================
     THEME: 暗色默认 + localStorage + 按钮切换
     ================================================================ */

  var saved = localStorage.getItem('theme');
  if (saved) {
    html.setAttribute('data-theme', saved);
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  /* ================================================================
     READING PROGRESS BAR
     ================================================================ */

  var progressBar = document.createElement('div');
  progressBar.className = 'reading-progress';
  progressBar.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(progressBar, document.body.firstChild);

  var progTicking = false;
  window.addEventListener('scroll', function () {
    if (!progTicking) {
      requestAnimationFrame(function () {
        var scrollTop = window.scrollY;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        var pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
        progressBar.style.width = pct + '%';
        progTicking = false;
      });
      progTicking = true;
    }
  });

  /* ================================================================
     ACTIVE NAV
     ================================================================ */

  var navLinks = document.querySelectorAll('.nav-menu a');
  navLinks.forEach(function (link) {
    var href = link.getAttribute('href');
    if (!href) return;
    if (href === './' || href === '../') {
      if (path === '/' || path.endsWith('/index.html')) {
        var segs = path.replace(/\/index\.html$/, '').split('/').filter(Boolean);
        if (segs.length === 0) link.classList.add('active');
      }
      return;
    }
    var slug = href.replace(/^\.\.?\//, '').replace(/\/$/, '');
    if (slug && path.indexOf('/' + slug) !== -1) {
      link.classList.add('active');
    }
  });

  /* ================================================================
     MOBILE MENU TOGGLE
     ================================================================ */

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

  /* ================================================================
     THEME TOGGLE BUTTON
     ================================================================ */

  var themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var current = html.getAttribute('data-theme');
      var next = current === 'light' ? 'dark' : 'light';
      setTheme(next);
    });
  }

  /* ================================================================
     TABLE OF CONTENTS — 从 .section 的 h2 自动生成侧栏目录
     ================================================================ */

  var tocSidebar = document.querySelector('.toc-sidebar');
  if (tocSidebar) {
    var sections = document.querySelectorAll('.section');
    if (sections.length > 0) {
      var tocList = document.createElement('ul');
      tocList.className = 'toc-list';

      sections.forEach(function (sec) {
        var h2 = sec.querySelector('h2');
        if (!h2) return;

        // 给 section 和 h2 同时设置 id
        var baseId = h2.textContent.replace(/\s+/g, '-').replace(/[^\w一-鿿\-]/g, '');
        var id = h2.id || baseId;
        sec.id = sec.id || id;
        h2.id = h2.id || id;

        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + id;
        a.textContent = h2.textContent;
        li.appendChild(a);
        tocList.appendChild(li);
      });

      tocSidebar.appendChild(tocList);

      // IntersectionObserver 高亮当前章节
      var tocLinks = tocList.querySelectorAll('a');
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var id = entry.target.id;
          var link = tocSidebar.querySelector('a[href="#' + id + '"]');
          if (link) {
            if (entry.isIntersecting) {
              tocLinks.forEach(function (l) { l.classList.remove('toc-active'); });
              link.classList.add('toc-active');
            }
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

      sections.forEach(function (sec) {
        var h2 = sec.querySelector('h2');
        if (h2) observer.observe(sec);
      });

      // 显示侧栏
      tocSidebar.classList.add('toc-sidebar--visible');
    }
  }

  /* ================================================================
     KEYBOARD NAVIGATION — ← → 前后章跳转
     ================================================================ */

  var prevLink = document.querySelector('.chapter-nav__prev a');
  var nextLink = document.querySelector('.chapter-nav__next a');

  if (prevLink || nextLink) {
    document.addEventListener('keydown', function (e) {
      // 不在输入框中时响应
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowLeft' && prevLink) {
        e.preventDefault();
        window.location.href = prevLink.getAttribute('href');
      } else if (e.key === 'ArrowRight' && nextLink) {
        e.preventDefault();
        window.location.href = nextLink.getAttribute('href');
      }
    });
  }

  /* ================================================================
     BACK TO TOP
     ================================================================ */

  var btn = document.querySelector('.back-to-top');
  if (btn) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          if (window.scrollY > 400) btn.classList.add('back-to-top--visible');
          else btn.classList.remove('back-to-top--visible');
          ticking = false;
        });
        ticking = true;
      }
    });
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ================================================================
     HERO SHADER CANVAS（TBoS 风格）
     ================================================================ */

  var hero = document.querySelector('.site-hero');
  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (hero && !prefersReducedMotion) {
    var canvas = document.createElement('canvas');
    canvas.className = 'shader-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    hero.insertBefore(canvas, hero.firstChild);

    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;

    function resize() {
      var rect = hero.getBoundingClientRect();
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    var styles = getComputedStyle(document.documentElement);
    var accent = (styles.getPropertyValue('--accent') || '#e07040').trim();
    var bgSoft = (styles.getPropertyValue('--bg-soft') || '#23211c').trim();

    function hexToRgb(hex) {
      hex = hex.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
      var n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var accRgb = hexToRgb(accent);
    var bgRgb = hexToRgb(bgSoft);

    var start = performance.now();
    var running = true;

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { running = e.isIntersecting; if (running) loop(); });
      });
      io.observe(hero);
    }

    function loop(now) {
      if (!running) return;
      now = now || performance.now();
      var t = (now - start) / 1000;

      ctx.clearRect(0, 0, w, h);

      var grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, 'rgba(' + bgRgb.join(',') + ',0)');
      grad.addColorStop(1, 'rgba(' + accRgb.join(',') + ',0.06)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      var lines = 4;
      for (var i = 0; i < lines; i++) {
        var phase = t * 0.2 + i * 1.6;
        var amp = h * 0.05 + i * 5;
        var freq = 0.0035 + i * 0.0008;
        var yBase = h * (0.4 + i * 0.13);
        ctx.beginPath();
        for (var x = 0; x <= w; x += 4) {
          var y = yBase
            + Math.sin(x * freq + phase) * amp
            + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(' + accRgb.join(',') + ',' + (0.10 - i * 0.02) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
})();
