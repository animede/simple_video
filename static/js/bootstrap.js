(function () {
  function parseMarkdown(markdown) {
    let html = String(markdown || '');

    html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const index = codeBlocks.length;
      codeBlocks.push(`<pre><code class="language-${lang}">${String(code || '').trim()}</code></pre>`);
      return `___CODEBLOCK_${index}___`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/^\*\*\*$/gm, '<hr>');

    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';

    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*(<h[123]>)/g, '$1');
    html = html.replace(/(<\/h[123]>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)\s*<\/p>/g, '$1');
    html = html.replace(/<p>\s*(<hr>)/g, '$1');
    html = html.replace(/(<hr>)\s*<\/p>/g, '$1');

    codeBlocks.forEach((block, index) => {
      html = html.replace(`___CODEBLOCK_${index}___`, block);
    });

    return html;
  }

  function setupFloatingGuidePanel(apiBase) {
    const panel = document.getElementById('floatingGuidePanel');
    const header = document.getElementById('floatingGuideHeader');
    const closeBtn = document.getElementById('floatingGuideClose');
    const minimizeBtn = document.getElementById('floatingGuideMinimize');
    const body = document.getElementById('floatingGuideBody');
    const tabs = document.getElementById('floatingGuideTabs');
    if (!panel || !header || !body) return null;

    const state = { currentDocKey: 'tutorial' };

    const setTabActive = (docKey) => {
      const buttons = tabs?.querySelectorAll('.floating-guide-tab') || [];
      buttons.forEach((button) => {
        const isActive = button.getAttribute('data-doc-key') === docKey;
        button.classList.toggle('active', isActive);
      });
    };

    const loadDoc = async (docKey) => {
      const key = String(docKey || '').trim() || 'tutorial';
      if (body.dataset.loaded === key) return;

      body.innerHTML = '<div class="floating-guide-loading">読み込み中...</div>';
      setTabActive(key);

      const url = `${apiBase}/api/v1/simple-video/help/${encodeURIComponent(key)}`;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const markdown = await res.text();
        body.innerHTML = parseMarkdown(markdown);
        body.dataset.loaded = key;
        state.currentDocKey = key;
        body.scrollTop = 0;
      } catch (error) {
        body.innerHTML = `
          <div style="text-align:center; padding:40px;">
            <p style="color: var(--error-color);">❌ ヘルプの読み込みに失敗しました</p>
            <p style="margin-top: 10px; color: var(--text-secondary); font-size: 12px;">${error?.message || String(error)}</p>
          </div>
        `;
      }
    };

    const extractHelpDocKey = (href) => {
      const raw = String(href || '').trim();
      if (!raw) return null;
      try {
        const url = new URL(raw, window.location.origin);
        const marker = '/api/v1/simple-video/help/';
        const idx = url.pathname.indexOf(marker);
        if (idx < 0) return null;
        const tail = url.pathname.slice(idx + marker.length).split('/').filter(Boolean);
        if (!tail.length) return null;
        return decodeURIComponent(tail[0]);
      } catch (_error) {
        return null;
      }
    };

    tabs?.addEventListener('click', (event) => {
      const tab = event.target.closest('.floating-guide-tab');
      if (!tab) return;
      const key = tab.getAttribute('data-doc-key') || 'tutorial';
      loadDoc(key);
    });

    body.addEventListener('click', (event) => {
      const anchor = event.target.closest('a[href]');
      if (!anchor) return;
      const docKey = extractHelpDocKey(anchor.getAttribute('href'));
      if (!docKey) return;
      event.preventDefault();
      event.stopPropagation();
      loadDoc(docKey);
    });

    closeBtn?.addEventListener('click', () => {
      panel.classList.remove('active');
    });

    minimizeBtn?.addEventListener('click', () => {
      panel.classList.toggle('minimized');
      minimizeBtn.textContent = panel.classList.contains('minimized') ? '□' : '─';
    });

    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;

    header.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return;
      isDragging = true;
      initialX = event.clientX - panel.offsetLeft;
      initialY = event.clientY - panel.offsetTop;
      header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (event) => {
      if (!isDragging) return;
      event.preventDefault();

      currentX = event.clientX - initialX;
      currentY = event.clientY - initialY;

      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      panel.style.left = `${currentX}px`;
      panel.style.top = `${currentY}px`;
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'move';
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && panel.classList.contains('active')) {
        panel.classList.remove('active');
      }
    });

    const open = async (docKey = 'tutorial') => {
      panel.classList.add('active');
      panel.classList.remove('minimized');
      if (minimizeBtn) minimizeBtn.textContent = '─';
      await loadDoc(docKey);
    };

    return { open, state };
  }

  function defaultApiBase() {
    return window.location.origin;
  }

  function resolveApiBase() {
    // Standalone policy: always use same-origin API unless explicitly overridden via ?api=
    // This avoids accidental reuse of previously saved coordinator/worker endpoints.
    const params = new URLSearchParams(window.location.search);
    const fromQuery = String(params.get('api') || '').trim();
    if (fromQuery) return fromQuery;
    const fromMeta = document.querySelector('meta[name="simple-video-api-base"]')?.content?.trim();
    if (fromMeta) return fromMeta;
    return defaultApiBase();
  }

  function showToast(message, level) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.className = `toast show ${level || 'info'}`;
    setTimeout(() => {
      toast.className = 'toast';
    }, 2800);
  }

  function toggleSimpleVideoMode(_enabled) {
    showToast('このアプリは かんたん動画専用 です', 'info');
  }

  const apiBase = resolveApiBase();
  localStorage.setItem('simple_video_api_base', apiBase);

  document.body.classList.add('simple-video-enabled');

  window.showToast = showToast;
  window.toggleSimpleVideoMode = toggleSimpleVideoMode;
  window.app = { api: new window.ComfyUIAPI(apiBase) };
  const floatingHelp = setupFloatingGuidePanel(apiBase);

  const backBtn = document.getElementById('simpleVideoBackBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showToast('かんたん動画専用モードで実行中', 'info');
    });
  }

  const helpBtn = document.getElementById('simpleVideoHelpBtn');
  if (helpBtn) {
    helpBtn.addEventListener('click', async () => {
      if (floatingHelp?.open) {
        await floatingHelp.open('tutorial');
        return;
      }

      const url = `${apiBase}/api/v1/simple-video/help`;
      window.open(url, '_blank', 'noopener');
    });
  }

  if (typeof window.initSimpleVideoUI === 'function') {
    window.initSimpleVideoUI();
    showToast(`API: ${apiBase}`, 'success');
  } else {
    console.error('initSimpleVideoUI is not available');
  }
})();
