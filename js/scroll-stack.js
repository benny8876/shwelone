
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowMq = window.matchMedia('(max-width: 768px)');

  function initScrollStack(root, options = {}) {
    if (!root || reduceMotion) return null;

    const {
      itemDistance = 100,
      itemScale = 0.03,
      itemStackDistance = 30,
      stackPosition = '20%',
      scaleEndPosition = '10%',
      baseScale = 0.85,
      rotationAmount = 0,
      blurAmount = 0,
      onStackComplete = null,
    } = options;

    const cards = Array.from(root.querySelectorAll('.scroll-stack-card'));
    const endElement = root.querySelector('.scroll-stack-end');
    if (!cards.length || !endElement) return null;

    root.classList.add('is-window-scroll');

    let stackCompleted = false;
    let isUpdating = false;
    let unbound = false;
    let rafPending = 0;
    let active = false;
    const lastTransforms = new Map();
    let cardTops = [];
    let endTop = 0;

    const parsePercentage = (value, containerHeight) => {
      if (typeof value === 'string' && String(value).includes('%')) {
        return (parseFloat(value) / 100) * containerHeight;
      }
      return parseFloat(value);
    };

    const calculateProgress = (scrollTop, start, end) => {
      if (scrollTop < start) return 0;
      if (scrollTop > end) return 1;
      return (scrollTop - start) / (end - start);
    };

    const getScrollTop = () => {
      if (window.lenis && typeof window.lenis.scroll === 'number') {
        return window.lenis.scroll;
      }
      return window.pageYOffset || document.documentElement.scrollTop || 0;
    };

    const clearInlineStyles = () => {
      cards.forEach((card) => {
        card.style.transform = '';
        card.style.filter = '';
        card.style.marginBottom = '';
        card.style.willChange = '';
      });
      lastTransforms.clear();
      cardTops = [];
      endTop = 0;
    };

    const applyDesktopBaseStyles = () => {
      cards.forEach((card, i) => {
        card.style.marginBottom = i < cards.length - 1 ? `${itemDistance}px` : '';
        card.style.willChange = 'transform';
        card.style.transformOrigin = 'top center';
        card.style.backfaceVisibility = 'hidden';
      });
    };

    const cacheLayout = () => {
      cards.forEach((card) => {
        card.style.transform = 'none';
        card.style.filter = '';
      });
      void root.offsetHeight;

      const y = window.pageYOffset || document.documentElement.scrollTop || 0;
      cardTops = cards.map((card) => Math.round(card.getBoundingClientRect().top + y));
      endTop = Math.round(endElement.getBoundingClientRect().top + y);
      lastTransforms.clear();
    };

    const updateCardTransforms = () => {
      if (!active || unbound || isUpdating || !cardTops.length) return;
      isUpdating = true;

      const scrollTop = getScrollTop();
      const containerHeight = window.innerHeight;
      const stackPositionPx = parsePercentage(stackPosition, containerHeight);
      const scaleEndPositionPx = parsePercentage(scaleEndPosition, containerHeight);
      const pinEnd = endTop - containerHeight * 0.12;

      let topCardIndex = 0;
      if (blurAmount) {
        for (let j = 0; j < cards.length; j++) {
          const jTriggerStart = cardTops[j] - stackPositionPx - itemStackDistance * j;
          if (scrollTop >= jTriggerStart) topCardIndex = j;
        }
      }

      cards.forEach((card, i) => {
        const cardTop = cardTops[i];
        const triggerStart = cardTop - stackPositionPx - itemStackDistance * i;
        const triggerEnd = cardTop - scaleEndPositionPx;
        const pinStart = triggerStart;

        const scaleProgress = calculateProgress(scrollTop, triggerStart, triggerEnd);
        const targetScale = baseScale + i * itemScale;
        const scale = 1 - scaleProgress * (1 - targetScale);

        let blur = 0;
        if (blurAmount && i < topCardIndex) {
          blur = Math.max(0, (topCardIndex - i) * blurAmount);
        }

        let translateY = 0;
        if (scrollTop >= pinStart && scrollTop <= pinEnd) {
          translateY = scrollTop - cardTop + stackPositionPx + itemStackDistance * i;
        } else if (scrollTop > pinEnd) {
          translateY = pinEnd - cardTop + stackPositionPx + itemStackDistance * i;
        }

        const newTransform = {
          translateY: Math.round(translateY),
          scale: Math.round(scale * 1000) / 1000,
          blur: Math.round(blur * 10) / 10,
        };

        const last = lastTransforms.get(i);
        const hasChanged =
          !last ||
          last.translateY !== newTransform.translateY ||
          last.scale !== newTransform.scale ||
          last.blur !== newTransform.blur;

        if (hasChanged) {
          card.style.transform = `translate3d(0, ${newTransform.translateY}px, 0) scale(${newTransform.scale})`;
          card.style.filter = newTransform.blur > 0 ? `blur(${newTransform.blur}px)` : 'none';
          lastTransforms.set(i, newTransform);
        }

        if (i === cards.length - 1) {
          const isInView = scrollTop >= pinStart && scrollTop <= pinEnd;
          if (isInView && !stackCompleted) {
            stackCompleted = true;
            if (typeof onStackComplete === 'function') onStackComplete();
          } else if (!isInView && stackCompleted) {
            stackCompleted = false;
          }
        }
      });

      isUpdating = false;
    };

    const scheduleUpdate = () => {
      if (!active || rafPending) return;
      rafPending = requestAnimationFrame(() => {
        rafPending = 0;
        updateCardTransforms();
      });
    };

    const enableDesktop = () => {
      active = true;
      root.classList.remove('is-sticky-stack');
      root.classList.add('is-js-stack');
      applyDesktopBaseStyles();
      cacheLayout();
      updateCardTransforms();
    };

    const enableMobileSticky = () => {
      active = false;
      root.classList.add('is-sticky-stack');
      root.classList.remove('is-js-stack');
      clearInlineStyles();
    };

    const syncMode = () => {
      if (narrowMq.matches) enableMobileSticky();
      else enableDesktop();
    };

    let resizeTimer = 0;
    const onResizeDebounced = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (narrowMq.matches) {
          enableMobileSticky();
          return;
        }
        enableDesktop();
      }, 120);
    };

    let lenisOff = null;
    const bindScroll = () => {
      if (window.lenis && typeof window.lenis.on === 'function') {
        window.lenis.on('scroll', scheduleUpdate);
        lenisOff = () => {
          if (window.lenis && typeof window.lenis.off === 'function') {
            window.lenis.off('scroll', scheduleUpdate);
          }
        };
      } else {
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        lenisOff = () => window.removeEventListener('scroll', scheduleUpdate);
      }
    };

    // Only bind JS scroll stack listeners on desktop
    if (!narrowMq.matches) bindScroll();

    window.addEventListener('resize', onResizeDebounced, { passive: true });
    if (typeof narrowMq.addEventListener === 'function') {
      narrowMq.addEventListener('change', () => {
        if (narrowMq.matches) {
          if (lenisOff) {
            lenisOff();
            lenisOff = null;
          }
          window.removeEventListener('scroll', scheduleUpdate);
        } else if (!lenisOff) {
          bindScroll();
        }
        syncMode();
      });
    }

    syncMode();

    return () => {
      unbound = true;
      active = false;
      if (rafPending) cancelAnimationFrame(rafPending);
      clearTimeout(resizeTimer);
      if (lenisOff) lenisOff();
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', onResizeDebounced);
      clearInlineStyles();
      root.classList.remove('is-sticky-stack', 'is-js-stack');
    };
  }

  function boot() {
    document.querySelectorAll('[data-scroll-stack]').forEach((root) => {
      initScrollStack(root, {
        itemDistance: 100,
        itemScale: 0.025,
        itemStackDistance: 24,
        stackPosition: '20%',
        scaleEndPosition: '10%',
        baseScale: 0.92,
        rotationAmount: 0,
        blurAmount: 0,
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    requestAnimationFrame(() => requestAnimationFrame(boot));
  }
})();
