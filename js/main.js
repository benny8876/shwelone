/* Shwe Lone Myanmar — interactions */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const narrowScreen = window.matchMedia('(max-width: 768px)').matches;
  /* Lenis perpetual RAF feels heavy on touch — desktop/fine pointer only */
  const useLenis = !reduceMotion && finePointer && !narrowScreen && typeof Lenis !== 'undefined';

  /* Smooth scroll (Lenis) — shared RAF with effects */
  let lenis = null;
  let sharedRafId = 0;
  let effectsNeedFrame = false;

  function sharedRaf(time) {
    sharedRafId = 0;
    if (lenis) lenis.raf(time);
    const effectsBusy = tickEffects();
    if (lenis || effectsBusy || effectsNeedFrame) {
      sharedRafId = requestAnimationFrame(sharedRaf);
    }
  }

  function kickRaf() {
    if (!sharedRafId) sharedRafId = requestAnimationFrame(sharedRaf);
  }

  function scrollToTarget(target, offset) {
    if (!target) return;
    if (lenis) {
      lenis.scrollTo(target, { offset: offset || -96 });
      return;
    }
    const top = target.getBoundingClientRect().top + window.pageYOffset + (offset || -96);
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  if (useLenis) {
    lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      touchMultiplier: 1,
    });
    window.lenis = lenis;
    kickRaf();
  }

  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const id = anchor.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      scrollToTarget(target, -96);
    });
  });

  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  let scrollTick = 0;
  function onScroll() {
    if (scrollTick) return;
    scrollTick = requestAnimationFrame(() => {
      scrollTick = 0;
      if (header) {
        const y = lenis ? lenis.scroll : window.scrollY;
        header.classList.toggle('is-scrolled', y > 40);
      }
      setActiveNav();
    });
  }

  if (lenis) {
    lenis.on('scroll', onScroll);
  } else {
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  onScroll();

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });
    links.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => links.classList.remove('open'));
    });
  }

  /* FAQ accordion */
  document.querySelectorAll('.faq-q').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const open = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((el) => el.classList.remove('open'));
      if (!open) item.classList.add('open');
    });
  });

  /* Consultation sessions accordion */
  document.querySelectorAll('.engage-summary').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.engage-item');
      const open = item.classList.contains('is-open');
      document.querySelectorAll('.engage-item.is-open').forEach((el) => {
        el.classList.remove('is-open');
        const b = el.querySelector('.engage-summary');
        const hint = el.querySelector('.engage-details-hint');
        if (b) b.setAttribute('aria-expanded', 'false');
        if (hint) hint.textContent = 'Details';
      });
      if (!open) {
        item.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        const hint = item.querySelector('.engage-details-hint');
        if (hint) hint.textContent = 'Close';
      }
    });
  });

  /* Practice area card accordion */
  document.querySelectorAll('.pa-card-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.pa-card-accordion');
      if (!card) return;
      const open = card.classList.contains('is-open');
      document.querySelectorAll('.pa-card-accordion.is-open').forEach((el) => {
        el.classList.remove('is-open');
        const toggle = el.querySelector('.pa-card-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
      if (!open) {
        card.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* Scroll reveal + staggered grids */
  const staggerGroups = [
    { root: document.querySelector('.pa-grid'), item: '.pa-card.reveal' },
    { root: document.querySelector('.engage-accordion#engage-accordion'), item: '.engage-item.reveal' },
    { root: document.querySelector('.retainer-grid'), item: '.retainer-card.reveal' },
    { root: document.querySelector('.insights-grid'), item: '.insight-card.reveal' },
  ].filter((g) => g.root && g.root.querySelectorAll(g.item).length);

  const staggerItems = new Set();
  staggerGroups.forEach((g) => {
    g.root.querySelectorAll(g.item).forEach((el) => staggerItems.add(el));
  });

  const reveals = document.querySelectorAll('.reveal, .reveal-text');

  const showGroup = (root, itemSel) => {
    root.querySelectorAll(itemSel).forEach((el) => el.classList.add('visible'));
  };

  if (reveals.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const group = staggerGroups.find((g) => g.root === e.target);
          if (group) {
            showGroup(group.root, group.item);
          } else {
            e.target.classList.add('visible');
          }
          io.unobserve(e.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    staggerGroups.forEach((g) => io.observe(g.root));

    reveals.forEach((el) => {
      if (staggerItems.has(el)) return;
      io.observe(el);
    });
  } else {
    reveals.forEach((el) => el.classList.add('visible'));
  }

  /* BlurText (react-bits style) — word-by-word blur reveal */
  function initBlurText(el) {
    if (!el || el.dataset.blurReady === '1') return;
    const raw = el.textContent.replace(/\s+/g, ' ').trim();
    if (!raw) return;

    const delay = Number(el.dataset.blurDelay || 150);
    const direction = el.dataset.blurDirection || 'top';
    const fromY = direction === 'top' ? -50 : 50;
    const midY = direction === 'top' ? 5 : -5;
    const words = raw.split(' ');

    el.setAttribute('aria-label', raw);
    el.textContent = '';
    el.style.setProperty('--blur-from-y', `${fromY}px`);
    el.style.setProperty('--blur-mid-y', `${midY}px`);

    words.forEach((word, i) => {
      const seg = document.createElement('span');
      seg.className = 'blur-text-seg';
      seg.textContent = word;
      seg.style.setProperty('--blur-delay', `${(i * delay) / 1000}s`);
      el.appendChild(seg);
      if (i < words.length - 1) {
        el.appendChild(document.createTextNode('\u00A0'));
      }
    });

    el.dataset.blurReady = '1';

    const play = () => el.classList.add('is-inview');

    if (reduceMotion) {
      play();
      return;
    }

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          play();
          io.disconnect();
        },
        { threshold: 0.1, rootMargin: '0px' }
      );
      io.observe(el);
    } else {
      play();
    }
  }

  document.querySelectorAll('[data-blur-text]').forEach(initBlurText);

  /* Hero stats count-up */
  const statsRoot = document.querySelector('.hero-stats');
  const counters = document.querySelectorAll('.stat-count');

  function animateCount(el, duration) {
    const target = Number(el.dataset.target || 0);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion) {
      el.textContent = target + suffix;
      return;
    }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (statsRoot && counters.length) {
    if ('IntersectionObserver' in window) {
      const statsIo = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            counters.forEach((el, i) => animateCount(el, 1100 + i * 80));
            statsIo.unobserve(e.target);
          });
        },
        { threshold: 0.35 }
      );
      statsIo.observe(statsRoot);
    } else {
      counters.forEach((el) => animateCount(el, 1000));
    }
  }

  /* Contact form */
  const contactForm = document.getElementById('contact-form');
  const planSelect = document.getElementById('c-plan');

  function setContactPlan(plan) {
    if (!planSelect || !plan) return;
    const opt = Array.from(planSelect.options).find((o) => o.value === plan);
    if (opt) {
      planSelect.value = plan;
      planSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  document.querySelectorAll('a[data-plan]').forEach((link) => {
    link.addEventListener('click', () => {
      setContactPlan(link.getAttribute('data-plan'));
    });
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('plan')) setContactPlan(params.get('plan'));

  if (contactForm) {
    const success = document.getElementById('contact-success');
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(contactForm).entries());
      if (planSelect && planSelect.selectedIndex >= 0) {
        data.planLabel = planSelect.options[planSelect.selectedIndex].text;
      }
      const msgs = JSON.parse(localStorage.getItem('harrington_messages') || '[]');
      msgs.push({ ...data, id: Date.now() });
      localStorage.setItem('harrington_messages', JSON.stringify(msgs));
      if (success) {
        success.classList.add('show');
        success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      contactForm.reset();
      if (planSelect) planSelect.selectedIndex = 0;
    });
  }

  /* Single-page hash nav active state */
  const sectionIds = ['home', 'services', 'profile', 'process', 'fees', 'retainers', 'insights', 'contact'];
  const navAnchors = document.querySelectorAll('.nav-links a[data-nav]');
  const sectionEls = sectionIds.map((id) => document.getElementById(id)).filter(Boolean);

  function setActiveNav() {
    if (!navAnchors.length) return;
    let current = 'home';
    const offset = 100;
    for (let i = 0; i < sectionEls.length; i++) {
      const el = sectionEls[i];
      if (el.getBoundingClientRect().top - offset <= 0) current = el.id;
    }
    navAnchors.forEach((a) => {
      const href = a.getAttribute('href') || '';
      a.classList.toggle('active', href === `#${current}`);
    });
  }

  if (navAnchors.length) setActiveNav();

  /* ——— Effects: magnetic + 3D cards (demand-driven RAF) ——— */
  const magnets = Array.from(document.querySelectorAll('.magnetic'));
  const cards3d = Array.from(document.querySelectorAll('.pa-card, .retainer-card'));

  let tickEffects = () => false;

  if (!reduceMotion && finePointer) {
    let effectsPaused = false;

    const near = (a, b) => Math.abs(a - b) < 0.08;

    function lerp(start, end, factor) {
      return start + (end - start) * factor;
    }

    function cacheRect(el) {
      el._rect = el.getBoundingClientRect();
    }

    magnets.forEach((btn) => {
      btn._tx = 0;
      btn._ty = 0;
      btn._cx = 0;
      btn._cy = 0;
      btn._active = false;
      btn.addEventListener('mouseenter', () => {
        cacheRect(btn);
        btn._active = true;
        effectsNeedFrame = true;
        kickRaf();
      });
      btn.addEventListener('mousemove', (e) => {
        const rect = btn._rect || btn.getBoundingClientRect();
        btn._tx = (e.clientX - rect.left - rect.width / 2) * 0.3;
        btn._ty = (e.clientY - rect.top - rect.height / 2) * 0.3;
        effectsNeedFrame = true;
        kickRaf();
      });
      btn.addEventListener('mouseleave', () => {
        btn._tx = 0;
        btn._ty = 0;
        btn._active = false;
        effectsNeedFrame = true;
        kickRaf();
      });
    });

    cards3d.forEach((card) => {
      card._rx = 0;
      card._ry = 0;
      card._crx = 0;
      card._cry = 0;
      card._s = 1;
      card._cs = 1;
      card._active = false;
      card.addEventListener('mouseenter', () => {
        cacheRect(card);
        card.style.transition = 'box-shadow 0.3s ease';
        card.style.transitionDelay = '0s';
        card.classList.add('is-tilting');
        card._active = true;
        effectsNeedFrame = true;
        kickRaf();
      });
      card.addEventListener('mousemove', (e) => {
        cacheRect(card);
        const rect = card._rect;
        if (!rect || !rect.width || !rect.height) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card._rx = ((y - rect.height / 2) / (rect.height / 2)) * -7;
        card._ry = ((x - rect.width / 2) / (rect.width / 2)) * 7;
        card._s = 1.03;
        card._active = true;
        effectsNeedFrame = true;
        kickRaf();
      });
      card.addEventListener('mouseleave', () => {
        card._rx = 0;
        card._ry = 0;
        card._s = 1;
        card._active = false;
        card.classList.remove('is-tilting');
        effectsNeedFrame = true;
        kickRaf();
      });
    });

    document.addEventListener('visibilitychange', () => {
      effectsPaused = document.hidden;
      if (!document.hidden) {
        effectsNeedFrame = true;
        kickRaf();
      }
    });

    const chatRoot = document.getElementById('chat-widget');
    if (chatRoot) {
      const mo = new MutationObserver(() => {
        effectsPaused = chatRoot.classList.contains('is-open') || document.hidden;
        if (!effectsPaused) {
          effectsNeedFrame = true;
          kickRaf();
        }
      });
      mo.observe(chatRoot, { attributes: true, attributeFilter: ['class'] });
    }

    tickEffects = function tickEffectsInner() {
      if (effectsPaused) {
        effectsNeedFrame = false;
        return false;
      }

      let busy = false;

      magnets.forEach((btn) => {
        if (!btn._active && near(btn._cx, btn._tx) && near(btn._cy, btn._ty)) return;
        btn._cx = lerp(btn._cx, btn._tx, 0.12);
        btn._cy = lerp(btn._cy, btn._ty, 0.12);
        btn.style.transform = `translate3d(${btn._cx}px, ${btn._cy}px, 0)`;
        if (!near(btn._cx, btn._tx) || !near(btn._cy, btn._ty)) busy = true;
      });

      cards3d.forEach((card) => {
        if (
          !card._active &&
          near(card._crx, card._rx) &&
          near(card._cry, card._ry) &&
          near(card._cs, card._s)
        ) {
          return;
        }
        card._crx = lerp(card._crx, card._rx, 0.12);
        card._cry = lerp(card._cry, card._ry, 0.12);
        card._cs = lerp(card._cs, card._s, 0.12);
        card.style.transform = `perspective(1000px) rotateX(${card._crx}deg) rotateY(${card._cry}deg) scale3d(${card._cs}, ${card._cs}, ${card._cs})`;
        if (!near(card._crx, card._rx) || !near(card._cry, card._ry) || !near(card._cs, card._s)) {
          busy = true;
        }
      });

      effectsNeedFrame = busy;
      return busy;
    };

    kickRaf();
  } else if (lenis) {
    kickRaf();
  }
})();
