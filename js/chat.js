
(function () {
  let faqData = {};
  let categories = [];

  const CONTACT_ADMIN_LABEL = 'တိုက်ရိုက်ဆက်သွယ်ရန် · Contact admin';
  const OFFICE_START_HOUR = 10;
  const OFFICE_END_HOUR = 18;

  function apiUrl(path) {
    return window.SiteApi ? SiteApi.apiUrl(path) : path;
  }

  function getMyanmarMinutes(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Yangon',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour').value);
    const minute = Number(parts.find((p) => p.type === 'minute').value);
    return hour * 60 + minute;
  }

  function isWithinOfficeHours(date = new Date()) {
    const mins = getMyanmarMinutes(date);
    return mins >= OFFICE_START_HOUR * 60 && mins < OFFICE_END_HOUR * 60;
  }

  function officeHoursMessage() {
    return [
      'ယခု ရုံးချိန် မဟုတ်ပါ။',
      '',
      'တိုက်ရိုက်ဆက်သွယ်ရန် ရုံးချိန်မှာ ဆက်သွယ်နိုင်ပါသည် —',
      'နံနက် ၁၀:၀၀ မှ ညနေ ၆:၀၀ အထိ (Myanmar Time)။',
      '',
      'ကျေးဇူးပြု၍ Contact Form မှတစ်ဆင့် စာပို့ပေးပါ။',
      'ရုံးဖွင့်ချိန်တွင် ပြန်လည်ဆက်သွယ်ပါမည်။',
    ].join('\n');
  }

  function initChat() {
    const root = document.getElementById('chat-widget');
    const panel = document.getElementById('chat-panel');
    const launcher = document.getElementById('chat-launcher');
    const messages = document.getElementById('chat-messages');
    const form = document.getElementById('chat-compose');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    if (!root || !panel || !launcher || !messages) return;

    const closeBtn = panel.querySelector('.chat-close');
    const backBtn = panel.querySelector('.chat-back');
    let currentCatId = null;
    let liveSessionId = null;
    let liveStatus = null;
    let pollTimer = null;
    let eventSource = null;
    let useSse = typeof EventSource !== 'undefined';
    let messageCursor = 0;
    let liveIntakeStep = null;
    let pendingVisitorName = '';
    let liveEndHandled = false;
    let pollFailCount = 0;
    let pollNotFoundCount = 0;
    let pollBackoffMs = 2000;
    let outboundQueue = [];
    let flushingQueue = false;
    const SESSION_STORE_KEY = 'shwelone_live_chat';
    const DEFAULT_INPUT_PLACEHOLDER = 'Type your message…';
    const LOCKED_INPUT_PLACEHOLDER =
      'တိုက်ရိုက်ဆက်သွယ်ရန် ကို နှိပ်ပြီး စာပို့နိုင်ပါသည်…';
    const POLL_BASE_MS = 2000;
    const POLL_MAX_MS = 12000;
    const FETCH_TIMEOUT_MS = 15000;
    const PRIVACY_CONSENT_TEXT = [
      'တိုက်ရိုက်ဆက်သွယ်မှု မစမီ အောက်ပါအချက်များကို သဘောတူပါ —',
      '',
      '• ဤ chat သည် ယေဘုယျအချက်အလက်အတွက်သာ ဖြစ်ပြီး တရားဝင် ဥပဒေအကြံပေးချက် မဟုတ်ပါ။',
      '• သင့်အမည်နှင့် မက်ဆေ့ဂျ်များကို ရုံးသို့ ပေးပို့သိမ်းဆည်းနိုင်ပါသည်။',
      '• Privacy Policy ကို ဖတ်ရှုပြီးမှ ဆက်သွယ်ပါ။',
    ].join('\n');

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function trackEvent(type, meta = {}) {
      try {
        const body = JSON.stringify({ type, ...meta });
        const url = apiUrl('/api/chat/analytics/track');
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
          return;
        }
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch (_) {
     
      }
    }

    function persistLiveSession() {
      try {
        if (!liveSessionId || liveStatus === 'closed' || liveStatus === 'rejected') {
          sessionStorage.removeItem(SESSION_STORE_KEY);
          return;
        }
        sessionStorage.setItem(
          SESSION_STORE_KEY,
          JSON.stringify({
            sessionId: liveSessionId,
            status: liveStatus,
            messageCursor,
          })
        );
      } catch (_) {
        
      }
    }

    function clearPersistedSession() {
      try {
        sessionStorage.removeItem(SESSION_STORE_KEY);
      } catch (_) {
        
      }
    }

    function readPersistedSession() {
      try {
        const raw = sessionStorage.getItem(SESSION_STORE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.sessionId) return null;
        return data;
      } catch {
        return null;
      }
    }

    async function loadFaqData() {
      try {
        const res = await fetch(apiUrl('/api/faq'), { cache: 'no-store' });
        if (!res.ok) throw new Error('FAQ load failed');
        const data = await res.json();
        const cats = Array.isArray(data.categories) ? data.categories : [];
        categories = cats.map((c) => ({
          id: c.id,
          label: c.label || c.id,
          items: Array.isArray(c.items) ? c.items : [],
        }));
        faqData = {};
        categories.forEach((c) => {
          faqData[c.id] = c.items.map((item) => ({
            id: item.id,
            q: item.q,
            a: item.a,
          }));
        });
      } catch (err) {
        console.warn('FAQ load:', err.message);
        categories = [];
        faqData = {};
      }
    }

    async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    function canUseCompose() {
      return !!liveIntakeStep || isLiveActive() || isLivePending();
    }

    function updateComposeState() {
      const locked = !canUseCompose();
      if (form) form.classList.toggle('is-locked', locked);
      if (input) {
        input.disabled = locked;
        if (locked) {
          input.value = '';
          input.style.height = 'auto';
          input.placeholder = LOCKED_INPUT_PLACEHOLDER;
        } else if (!liveIntakeStep) {
          input.placeholder = DEFAULT_INPUT_PLACEHOLDER;
        }
      }
      if (sendBtn) sendBtn.disabled = locked;
    }

    function stopLiveStream() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (eventSource) {
        try {
          eventSource.close();
        } catch (_) {
         
        }
        eventSource = null;
      }
    }

    function scheduleLivePoll(delayMs = pollBackoffMs) {
      stopLiveStream();
      if (!liveSessionId) return;
      useSse = false;
      pollTimer = window.setTimeout(() => {
        pollLiveSession();
      }, delayMs);
    }

    function cancelLiveIntake() {
      liveIntakeStep = null;
      pendingVisitorName = '';
      updateComposeState();
    }

    function isLiveActive() {
      return liveSessionId && liveStatus === 'active';
    }

    function isLivePending() {
      return liveSessionId && liveStatus === 'pending';
    }

    function endLiveSessionUi(greeting = 'ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?') {
      stopLiveStream();
      liveSessionId = null;
      liveStatus = null;
      messageCursor = 0;
      liveEndHandled = false;
      clearPersistedSession();
      cancelLiveIntake();
      currentCatId = null;
      setBackVisible(false);
      updateComposeState();
      messages.innerHTML = '';
      showMainMenu(greeting);
    }

    function clearLiveSessionState() {
      stopLiveStream();
      liveSessionId = null;
      liveStatus = null;
      messageCursor = 0;
      pollFailCount = 0;
      pollNotFoundCount = 0;
      pollBackoffMs = POLL_BASE_MS;
      outboundQueue = [];
      flushingQueue = false;
      clearPersistedSession();
      cancelLiveIntake();
      setBackVisible(false);
      updateComposeState();
    }

    function applyPollPayload(data) {
      liveStatus = data.status;
      (data.messages || []).forEach((msg) => {
        if (msg.from === 'system' || msg.from === 'admin') {
          appendBubble(msg.text, 'bot', msg.from === 'system');
        }
      });
      if (typeof data.nextIndex === 'number') {
        messageCursor = data.nextIndex;
      } else if (data.full) {
        messageCursor = (data.messages || []).length;
      } else {
        messageCursor += (data.messages || []).length;
      }
      persistLiveSession();
      updateComposeState();

      if (liveStatus === 'active') {
        flushOutboundQueue();
      }
      if (liveStatus === 'rejected') {
        handleLiveRejected();
        return true;
      }
      if (liveStatus === 'closed') {
        handleLiveClosed();
        return true;
      }
      return false;
    }

    async function pollLiveSession() {
      if (!liveSessionId) return;
      try {
        const res = await fetchWithTimeout(
          apiUrl(`/api/chat/session/${encodeURIComponent(liveSessionId)}?since=${messageCursor}`)
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 404) {
            pollNotFoundCount += 1;
            if (pollNotFoundCount >= 3) {
              endLiveSessionUi('ဆက်သွယ်မှု ပြီးဆုံးပါပြီ။ ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?');
            } else {
              pollFailCount += 1;
              pollBackoffMs = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(1.6, pollFailCount));
              scheduleLivePoll();
            }
            return;
          }
          pollFailCount += 1;
          pollBackoffMs = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(1.6, pollFailCount));
          scheduleLivePoll();
          return;
        }

        pollFailCount = 0;
        pollNotFoundCount = 0;
        pollBackoffMs = POLL_BASE_MS;
        const ended = applyPollPayload(data);
        if (!ended) scheduleLivePoll(POLL_BASE_MS);
      } catch (err) {
        pollFailCount += 1;
        pollBackoffMs = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.pow(1.6, pollFailCount));
        console.warn('Live poll:', err.message);
        scheduleLivePoll();
      }
    }

    function startLiveSse() {
      if (!liveSessionId || typeof EventSource === 'undefined') {
        useSse = false;
        scheduleLivePoll(0);
        return;
      }
      stopLiveStream();
      useSse = true;
      const url = apiUrl(
        `/api/chat/session/${encodeURIComponent(liveSessionId)}/stream?since=${messageCursor}`
      );
      try {
        eventSource = new EventSource(url);
      } catch (err) {
        console.warn('SSE open failed:', err.message);
        useSse = false;
        scheduleLivePoll(0);
        return;
      }

      eventSource.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          pollFailCount = 0;
          pollNotFoundCount = 0;
          applyPollPayload(data);
        } catch (err) {
          console.warn('SSE parse:', err.message);
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          try {
            eventSource.close();
          } catch (_) {
            
          }
          eventSource = null;
        }
        if (!liveSessionId) return;
        console.warn('SSE disconnected — falling back to poll');
        useSse = false;
        scheduleLivePoll(1000);
      };
    }

    function startLiveUpdates() {
      pollFailCount = 0;
      pollNotFoundCount = 0;
      pollBackoffMs = POLL_BASE_MS;
      persistLiveSession();
      if (useSse) startLiveSse();
      else scheduleLivePoll(0);
    }

    async function sendLiveMessageToServer(text, { retries = 4 } = {}) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await fetchWithTimeout(apiUrl('/api/chat/live-message'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: liveSessionId, message: text }),
          });
          const data = await res.json().catch(() => ({}));

          if (res.ok) {
            if (data.telegramOk === false) {
              console.warn('Live message saved but Telegram delivery delayed');
            }
            return data;
          }

          if (res.status === 409) {
            await pollLiveSession();
            if (!isLiveActive()) throw new Error(data.error || 'Session not active');
            continue;
          }

          if (res.status === 429 || res.status >= 500) {
            await sleep(1200 * (attempt + 1));
            continue;
          }

          throw new Error(data.error || `HTTP ${res.status}`);
        } catch (err) {
          if (attempt === retries - 1) throw err;
          await sleep(1000 * (attempt + 1));
        }
      }
      throw new Error('Send failed');
    }

    async function flushOutboundQueue() {
      if (flushingQueue || !isLiveActive() || outboundQueue.length === 0) return;
      flushingQueue = true;
      const queue = [...outboundQueue];
      outboundQueue = [];

      for (const text of queue) {
        try {
          await sendLiveMessageToServer(text);
        } catch (err) {
          console.warn('Queued live message:', err.message);
          outboundQueue.push(text);
          appendBubble('စာပို့၍ မရပါ။ ထပ်ကြိုးစားပါ။', 'bot');
          break;
        }
      }

      flushingQueue = false;
    }

    function scrollToContactForm() {
      setOpen(false);
      const target = document.querySelector('#contact');
      if (!target) return;
      window.setTimeout(() => {
        if (window.lenis) {
          window.lenis.scrollTo(target, { offset: -96 });
        } else {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 80);
    }

    function showOutsideOfficeHours() {
      disableLastKeyboard();
      setBackVisible(false);
      appendBubble(CONTACT_ADMIN_LABEL, 'user');
      appendBubble(officeHoursMessage(), 'bot', true);
      appendKeyboard([
        {
          label: 'Contact Form သို့ သွားမယ်',
          onClick: () => {
            disableLastKeyboard();
            scrollToContactForm();
          },
          isContact: true,
        },
        {
          label: '← Main Menu',
          isBack: true,
          onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
        },
      ]);
    }

    function showLiveEndActions(kind) {
      const buttons =
        kind === 'rejected'
          ? [
              {
                label: 'ထပ်ကြိုးစားမယ် · Try again',
                onClick: () => {
                  disableLastKeyboard();
                  liveEndHandled = false;
                  if (!isWithinOfficeHours()) {
                    showOutsideOfficeHours();
                    return;
                  }
                  showPrivacyConsent();
                },
                isContact: true,
              },
              {
                label: 'Contact Form သို့ သွားမယ်',
                onClick: () => {
                  disableLastKeyboard();
                  scrollToContactForm();
                },
                isContact: true,
              },
              {
                label: '← Main Menu',
                isBack: true,
                onClick: () => {
                  disableLastKeyboard();
                  messages.innerHTML = '';
                  liveEndHandled = false;
                  goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?');
                },
              },
            ]
          : [
              {
                label: '← Main Menu',
                isBack: true,
                onClick: () => {
                  disableLastKeyboard();
                  messages.innerHTML = '';
                  liveEndHandled = false;
                  goMainMenu('အခြား ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?');
                },
              },
            ];

      appendKeyboard(buttons);
    }

    function handleLiveRejected() {
      if (liveEndHandled) return;
      liveEndHandled = true;
      clearLiveSessionState();
      window.setTimeout(() => showLiveEndActions('rejected'), 400);
    }

    function handleLiveClosed() {
      if (liveEndHandled) return;
      liveEndHandled = true;
      clearLiveSessionState();
      window.setTimeout(() => showLiveEndActions('closed'), 400);
    }

    function startLiveIntake() {
      if (liveSessionId && (liveStatus === 'pending' || liveStatus === 'active')) {
        appendBubble('ရုံးနှင့် ဆက်သွယ်မှု တောင်းဆိုထားပြီးသား ဖြစ်ပါသည်။', 'bot');
        return;
      }

      if (!isWithinOfficeHours()) {
        showOutsideOfficeHours();
        return;
      }

      disableLastKeyboard();
      liveIntakeStep = 'name';
      pendingVisitorName = '';
      setBackVisible(true);
      appendBubble('ရုံးနှင့် တိုက်ရိုက်ဆက်သွယ်ရန် သင့်နာမည် ရေးပေးပါ။', 'bot');
      updateComposeState();
      if (input) {
        input.placeholder = 'သင့်နာမည်…';
        input.focus();
      }
    }

    function showPrivacyConsent() {
      if (liveSessionId && (liveStatus === 'pending' || liveStatus === 'active')) {
        appendBubble('ရုံးနှင့် ဆက်သွယ်မှု တောင်းဆိုထားပြီးသား ဖြစ်ပါသည်။', 'bot');
        return;
      }

      if (!isWithinOfficeHours()) {
        showOutsideOfficeHours();
        return;
      }

      disableLastKeyboard();
      appendBubble(CONTACT_ADMIN_LABEL, 'user');
      appendBubble(PRIVACY_CONSENT_TEXT, 'bot', true);
      appendKeyboard([
        {
          label: 'သဘောတူပြီး ဆက်သွားမယ်',
          isContact: true,
          onClick: () => {
            disableLastKeyboard();
            startLiveIntake();
          },
        },
        {
          label: 'Privacy Policy ကြည့်ရန်',
          onClick: () => {
            window.open('privacy.html', '_blank', 'noopener');
          },
        },
        {
          label: '← Main Menu',
          isBack: true,
          onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
        },
      ]);
    }

    async function submitLiveRequest(visitorName, visitorReason) {
      try {
        const res = await fetch(apiUrl('/api/chat/live-request'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorName, visitorReason }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 403 && data.code === 'outside_office_hours') {
            cancelLiveIntake();
            setBackVisible(false);
            appendBubble(data.error || officeHoursMessage(), 'bot', true);
            appendKeyboard([
              {
                label: 'Contact Form သို့ သွားမယ်',
                onClick: () => scrollToContactForm(),
                isContact: true,
              },
              {
                label: '← Main Menu',
                isBack: true,
                onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
              },
            ]);
            return;
          }
          throw new Error(data.error || 'Request failed');
        }

        liveSessionId = data.sessionId;
        liveStatus = data.status || 'pending';
        messageCursor = 0;
        liveEndHandled = false;
        updateComposeState();
        startLiveUpdates();
      } catch (err) {
        console.warn('Live request:', err.message);
        appendBubble(
          'ယခု ဆက်သွယ်၍ မရသေးပါ။ နောက်မှ ထပ်ကြိုးစားပါ သို့မဟုတ် contact form မှတစ်ဆင့် ဆက်သွယ်ပါ။',
          'bot'
        );
        window.setTimeout(() => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'), 900);
      }
    }

    function handleLiveIntakeInput(text, done) {
      if (liveIntakeStep === 'name') {
        if (text.length < 2) {
          appendBubble('နာမည် အနည်းဆုံး ၂ လုံး ရေးပေးပါ။', 'bot');
          done();
          return;
        }
        pendingVisitorName = text;
        liveIntakeStep = 'reason';
        appendBubble('ဆက်သွယ်လိုသည့် အကြောင်းအရာ ရေးပေးပါ။', 'bot');
        if (input) {
          input.placeholder = 'ဆက်သွယ်လိုသည့် အကြောင်းအရာ…';
          input.focus();
        }
        done();
        return;
      }

      if (liveIntakeStep === 'reason') {
        if (text.length < 5) {
          appendBubble('အကြောင်းအရာ အနည်းဆုံး ၅ လုံး ရေးပေးပါ။', 'bot');
          done();
          return;
        }
        const name = pendingVisitorName;
        const reason = text;
        liveIntakeStep = null;
        pendingVisitorName = '';
        submitLiveRequest(name, reason).finally(done);
      }
    }

    async function requestLiveAdmin() {
      showPrivacyConsent();
    }

    function mainMenuButtons() {
      return [
        ...categories.map((cat) => ({
          label: cat.label,
          onClick: () => handleCategorySelect(cat),
        })),
        {
          label: CONTACT_ADMIN_LABEL,
          onClick: () => requestLiveAdmin(),
          isContact: true,
        },
      ];
    }

    function scrollToBottom() {
      messages.scrollTop = messages.scrollHeight;
    }

    function appendBubble(text, who, isInfo = false) {
      const el = document.createElement('div');
      el.className = 'chat-bubble ' + who + (isInfo ? ' is-info' : '');
      el.textContent = text;
      messages.appendChild(el);
      scrollToBottom();
      return el;
    }

    function disableLastKeyboard() {
      messages.querySelectorAll('.chat-inline-kb:not(.is-used)').forEach((kb) => {
        kb.classList.add('is-used');
        kb.querySelectorAll('button').forEach((btn) => {
          btn.disabled = true;
        });
      });
    }

    function appendKeyboard(buttons) {
      disableLastKeyboard();
      const kb = document.createElement('div');
      kb.className = 'chat-inline-kb';
      buttons.forEach(({ label, onClick, isBack, isContact }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = isBack
          ? 'chat-inline-btn is-back'
          : isContact
            ? 'chat-inline-btn is-contact'
            : 'chat-inline-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          if (kb.classList.contains('is-used')) return;
          onClick();
        });
        kb.appendChild(btn);
      });
      messages.appendChild(kb);
      scrollToBottom();
      return kb;
    }

    function setBackVisible(show) {
      if (!backBtn) return;
      backBtn.hidden = !show;
    }

    function goMainMenu(greeting) {
      currentCatId = null;
      cancelLiveIntake();
      setBackVisible(false);
      updateComposeState();
      showMainMenu(greeting);
    }

    function showMainMenu(greeting = "မင်္ဂလာပါ။ Stand Law Firm မှ ကြိုဆိုပါတယ်။ ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?") {
      appendBubble(greeting, 'bot');
      appendKeyboard(mainMenuButtons());
    }

    function handleCategorySelect(cat) {
      trackEvent('faq_category', { categoryId: cat.id, label: cat.label });
      appendBubble(cat.label, 'user');
      currentCatId = cat.id;
      setBackVisible(true);

      const data = faqData[cat.id];
      if (!data || data.length === 0) {
        setTimeout(() => {
          appendBubble('ဒီအကြောင်းအရာအတွက် FAQ များကို မကြာမီ ထည့်သွင်းပေးပါမည်။', 'bot');
          setTimeout(() => goMainMenu('အခြား ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'), 900);
        }, 350);
        return;
      }

      setTimeout(() => {
        appendBubble(cat.label + ' နဲ့ ပတ်သက်ပြီး အောက်ပါမေးခွန်းများကို ရွေးချယ်မေးမြန်းနိုင်ပါတယ်။', 'bot');
        showQuestions(cat.id);
      }, 350);
    }

    function showQuestions(catId) {
      const data = faqData[catId] || [];
      appendKeyboard([
        ...data.map((item) => ({
          label: item.q,
          onClick: () => handleQuestionSelect(item, catId),
        })),
        {
          label: '← နောက်သို့ (Main Menu)',
          isBack: true,
          onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
        },
      ]);
    }

    function handleQuestionSelect(item, catId) {
      const q = item.q;
      const a = item.a;
      trackEvent('faq_question', {
        categoryId: catId,
        questionId: item.id || q.slice(0, 80),
        label: q.slice(0, 120),
      });
      appendBubble(q, 'user');
      setTimeout(() => {
        const answerEl = appendBubble(a, 'bot');
        appendKeyboard([
          {
            label: 'မေးခွန်းများ ထပ်ရွေးရန်',
            onClick: () => showQuestions(catId),
          },
          {
            label: '← နောက်သို့ (Main Menu)',
            isBack: true,
            onClick: () => goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?'),
          },
        ]);
        window.setTimeout(() => {
          answerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }, 350);
    }

    function setOpen(open) {
      if (open) {
        panel.removeAttribute('hidden');
        panel.style.display = 'flex';
        root.classList.add('is-open');
        launcher.setAttribute('aria-expanded', 'true');
        if (messages.children.length === 0) {
          showMainMenu();
        }
        scrollToBottom();
        if (canUseCompose()) {
          window.setTimeout(() => input && input.focus(), 80);
        }
        if (window.lenis) window.lenis.stop();
        document.body.style.overflow = 'hidden';
      } else {
        panel.setAttribute('hidden', '');
        panel.style.display = 'none';
        root.classList.remove('is-open');
        launcher.setAttribute('aria-expanded', 'false');
        if (window.lenis) window.lenis.start();
        document.body.style.overflow = '';
      }
    }

    async function tryReconnectSession() {
      const saved = readPersistedSession();
      if (!saved?.sessionId) return false;
      try {
        const res = await fetchWithTimeout(
          apiUrl(`/api/chat/session/${encodeURIComponent(saved.sessionId)}?since=0`)
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          clearPersistedSession();
          return false;
        }
        if (data.status === 'closed' || data.status === 'rejected') {
          clearPersistedSession();
          return false;
        }
        liveSessionId = data.sessionId || saved.sessionId;
        liveStatus = data.status;
        messageCursor = 0;
        liveEndHandled = false;
        messages.innerHTML = '';
        appendBubble('ယခင် ဆက်သွယ်မှုကို ပြန်ချိတ်ဆက်ထားပါသည်။', 'bot', true);
        (data.messages || []).forEach((msg) => {
          if (msg.from === 'system' || msg.from === 'admin') {
            appendBubble(msg.text, 'bot', msg.from === 'system');
          } else if (msg.from === 'user') {
            appendBubble(msg.text, 'user');
          }
        });
        messageCursor = data.nextIndex ?? (data.messages || []).length;
        setBackVisible(true);
        updateComposeState();
        persistLiveSession();
        startLiveUpdates();
        return true;
      } catch (err) {
        console.warn('Reconnect:', err.message);
        return false;
      }
    }

    setOpen(false);
    updateComposeState();

    loadFaqData().then(() => {
      tryReconnectSession();
    });

    launcher.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!root.classList.contains('is-open'));
    });

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        goMainMenu('ဘယ်အကြောင်းအရာကို သိချင်ပါသလဲ?');
      });
    }

    const bookLink = panel.querySelector('.chat-head-link');
    if (bookLink) {
      bookLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        const target = document.querySelector('#contact');
        if (!target) return;
        window.setTimeout(() => {
          if (window.lenis) {
            window.lenis.scrollTo(target, { offset: -96 });
          } else {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 80);
      });
    }

    async function sendMessage() {
      if (!input || !canUseCompose()) return;
      const text = (input.value || '').trim();
      if (!text) return;

      appendBubble(text, 'user');
      input.value = '';
      input.style.height = 'auto';
      input.disabled = true;

      const done = () => {
        input.disabled = false;
      };

      if (liveIntakeStep) {
        handleLiveIntakeInput(text, done);
        return;
      }

      if (isLiveActive()) {
        sendLiveMessageToServer(text)
          .catch((err) => {
            console.warn('Live message:', err.message);
            appendBubble('စာပို့၍ မရပါ။ ထပ်ကြိုးစားပါ။', 'bot');
          })
          .finally(done);
        return;
      }

      if (isLivePending()) {
        outboundQueue.push(text);
        appendBubble('ရုံးမှ လက်ခံမှု စောင့်ဆိုင်းနေပါသည် — စာကို တန်းစီထားပါမည်။', 'bot');
        done();
        return;
      }
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
      });
    }

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 80) + 'px';
      });
    }

    
    window.addEventListener('online', () => {
      if (liveSessionId) {
        if (useSse) startLiveSse();
        else pollLiveSession();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && liveSessionId) {
        if (useSse && !eventSource) startLiveSse();
        else if (!useSse) pollLiveSession();
      }
    });

   
    messages.addEventListener(
      'wheel',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }
})();
