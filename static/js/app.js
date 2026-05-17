/* ═══════════════════════════════════════════════════
   YT Short Clipper Web – Client Application
   ═══════════════════════════════════════════════════ */

// ── Socket.IO ──────────────────────────────────────
const socket = io();
let currentJobId = null;
let currentSessionData = null;
let highlights = [];
let providers = [];

// ── Socket Events ──────────────────────────────────
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('connected', (data) => {
  console.log('Server version:', data.version);
});

socket.on('log', (data) => {
  if (data.job_id === currentJobId) {
    appendLog(data.message);
  }
});

socket.on('progress', (data) => {
  if (data.job_id === currentJobId) {
    updateProcessingProgress(data.step, data.progress);
  }
});

socket.on('highlights_ready', (data) => {
  if (data.job_id === currentJobId) {
    highlights = data.highlights || [];
    currentSessionData = {
      job_id: data.job_id,
      session_id: data.session_id,
      highlights: data.highlights,
      video_info: data.video_info,
      channel_name: data.channel_name,
    };
    showHighlightSelection();
  }
});

socket.on('clip_progress', (data) => {
  if (data.job_id === currentJobId) {
    updateClipProgress(data.step, data.progress);
  }
});

socket.on('clip_item_progress', (data) => {
  if (data.job_id === currentJobId) {
    const el = document.getElementById('clip-current');
    if (el) el.textContent = `Klip ${data.current}/${data.total}: ${data.title}`;
    const ct = document.getElementById('clip-count-text');
    if (ct) ct.textContent = `${data.current} / ${data.total} klip diproses`;
  }
});

socket.on('clipping_complete', (data) => {
  if (data.job_id === currentJobId) {
    showToast(`${data.clips_count} klip berhasil dibuat!`, 'success');
    document.getElementById('clip-cancel-btn').disabled = true;
    document.getElementById('clip-back-btn').disabled = false;
    document.getElementById('clip-sessions-btn').disabled = false;
    document.getElementById('clip-status').textContent = 'Semua klip selesai dibuat!';
    document.getElementById('clip-progress').style.width = '100%';
  }
});

socket.on('job_error', (data) => {
  if (data.job_id === currentJobId) {
    showToast(`Error: ${data.error}`, 'error');
    document.getElementById('back-home-btn').disabled = false;
    document.getElementById('processing-status').textContent = `Error: ${data.error}`;
    // Also handle clip page
    document.getElementById('clip-back-btn').disabled = false;
    document.getElementById('clip-status').textContent = `Error: ${data.error}`;
  }
});


// ── Page Navigation ────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  // Update nav buttons
  document.querySelectorAll('.header-nav button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });

  // Close any settings subpage
  if (name === 'settings') closeSettingsSubpage();

  // Load data for specific pages
  if (name === 'sessions') loadSessions();
  if (name === 'status') loadLibStatus();
  if (name === 'settings') loadSettingsData();
}


// ── Home Page ──────────────────────────────────────
let urlDebounce = null;
let selectedSourceVideo = null;

function onUrlChange() {
  clearTimeout(urlDebounce);
  const url = document.getElementById('url-input').value.trim();

  if (!url) {
    document.getElementById('thumbnail-preview').innerHTML =
      '<div class="placeholder"><div style="font-size:36px; margin-bottom:8px">🎬</div><div>Tempel link YouTube untuk melihat preview</div></div>';
    document.getElementById('video-title').textContent = '';
    document.getElementById('start-btn').disabled = !selectedSourceVideo;
    return;
  }

  // Quick thumbnail from video ID
  const videoId = extractVideoId(url);
  if (videoId) {
    document.getElementById('thumbnail-preview').innerHTML =
      `<img src="https://img.youtube.com/vi/${videoId}/maxresdefault.jpg"
            onerror="this.src='https://img.youtube.com/vi/${videoId}/hqdefault.jpg'">`;
    document.getElementById('start-btn').disabled = false;
  }

  // Debounced full info fetch
  urlDebounce = setTimeout(() => fetchVideoInfo(url), 800);
}

function extractVideoId(url) {
  const patterns = [
    /(?:v=|\/)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function onSourceVideoSelected(input) {
  const file = input.files[0];
  selectedSourceVideo = file || null;
  const nameEl = document.getElementById('source-video-name');

  if (!file) {
    nameEl.textContent = '';
    if (!document.getElementById('url-input').value.trim()) {
      document.getElementById('start-btn').disabled = true;
    }
    return;
  }

  nameEl.textContent = `${file.name} (${Math.round(file.size / 1024 / 1024)} MB)`;
  document.getElementById('start-btn').disabled = false;
  document.getElementById('thumbnail-preview').innerHTML =
    '<div class="placeholder"><div style="font-size:36px; margin-bottom:8px">🎞</div><div>Video yang di-upload dipilih</div></div>';
  document.getElementById('video-title').textContent = file.name;
}

async function fetchVideoInfo(url) {
  try {
    document.getElementById('subtitle-loading').style.display = 'block';
    const resp = await fetch('/api/video/info', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url}),
    });
    const data = await resp.json();

    if (data.title) {
      document.getElementById('video-title').textContent = data.title;
    }

    if (data.thumbnail) {
      document.getElementById('thumbnail-preview').innerHTML =
        `<img src="${data.thumbnail}" onerror="this.parentElement.innerHTML='<div class=placeholder>Tidak ada thumbnail</div>'">`;
    }

    // Populate subtitles
    if (data.subtitles && Object.keys(data.subtitles).length > 0) {
      const select = document.getElementById('subtitle-lang');
      select.innerHTML = '';
      for (const [code, label] of Object.entries(data.subtitles)) {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = label;
        if (code === 'id') opt.selected = true;
        select.appendChild(opt);
      }
      select.disabled = false;
    }
  } catch (e) {
    console.error('Video info error:', e);
  } finally {
    document.getElementById('subtitle-loading').style.display = 'none';
  }
}

async function pasteUrl() {
  try {
    const text = await navigator.clipboard.readText();
    document.getElementById('url-input').value = text;
    onUrlChange();
  } catch (e) {
    showToast('Tidak bisa mengakses clipboard', 'error');
  }
}


// ── YouTube Auth / Cookies ──────────────────────────
async function uploadCookies(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const resp = await fetch('/api/cookies/upload', {method: 'POST', body: formData});
    const data = await resp.json();
    if (data.status === 'ok') {
      showToast('Cookies berhasil di-upload!', 'success');
      checkCookiesStatus();
    }
  } catch (e) {
    showToast('Upload gagal', 'error');
  }
}

async function autoExtractCookies() {
  const btn = document.getElementById('btn-auto-login');
  const origText = btn.innerHTML;
  btn.innerHTML = '⏳ Mendeteksi browser...';
  btn.disabled = true;

  try {
    // First check available browsers
    const brResp = await fetch('/api/youtube/browsers');
    const brData = await brResp.json();

    if (brData.count === 0) {
      showToast('Tidak ada browser terdeteksi. Gunakan Upload Manual.', 'error');
      btn.innerHTML = origText;
      btn.disabled = false;
      return;
    }

    // If multiple browsers, show selector
    if (brData.count > 1) {
      const selector = document.getElementById('browser-selector');
      const select = document.getElementById('browser-select');
      const browserNames = {
        chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox',
        brave: 'Brave', chromium: 'Chromium', opera: 'Opera', vivaldi: 'Vivaldi'
      };
      select.innerHTML = brData.browsers.map(b =>
        `<option value="${b}">${browserNames[b] || b}</option>`
      ).join('');
      selector.style.display = 'block';
    }

    // Auto-extract from best browser
    btn.innerHTML = '⏳ Extracting cookies...';
    const resp = await fetch('/api/youtube/extract-cookies', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({})
    });
    const data = await resp.json();

    if (data.status === 'ok') {
      showToast(`Login berhasil! ${data.count} cookies dari ${data.browser}`, 'success');
      checkCookiesStatus();
    } else if (data.status === 'warning') {
      showToast(data.message, 'warning');
      checkCookiesStatus();
    } else {
      showToast(data.message || 'Gagal extract cookies', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }

  btn.innerHTML = origText;
  btn.disabled = false;
}

async function extractFromSelectedBrowser() {
  const browser = document.getElementById('browser-select').value;
  if (!browser) return;

  try {
    showToast(`Extracting dari ${browser}...`, 'info');
    const resp = await fetch('/api/youtube/extract-cookies', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({browser})
    });
    const data = await resp.json();

    if (data.status === 'ok') {
      showToast(`Login berhasil! ${data.count} cookies dari ${browser}`, 'success');
      checkCookiesStatus();
    } else {
      showToast(data.message || 'Gagal extract cookies', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function deleteCookies() {
  try {
    const resp = await fetch('/api/cookies/delete', {method: 'POST'});
    const data = await resp.json();
    showToast(data.message || 'Cookies dihapus', 'success');
    checkCookiesStatus();
  } catch (e) {
    showToast('Gagal menghapus cookies', 'error');
  }
}

async function checkCookiesStatus() {
  try {
    const resp = await fetch('/api/cookies/status');
    const data = await resp.json();
    const el = document.getElementById('cookies-status');
    const deleteRow = document.getElementById('cookies-delete-row');

    if (data.has_cookies) {
      if (data.valid) {
        el.innerHTML = `<span class="status-dot green"></span><span>Login aktif (${data.count} cookies)</span>`;
      } else {
        el.innerHTML = `<span class="status-dot yellow"></span><span>Cookies ada (${data.count}) tapi tidak lengkap</span>`;
      }
      if (deleteRow) deleteRow.style.display = 'block';
    } else {
      el.innerHTML = '<span class="status-dot red"></span><span>Belum login</span>';
      if (deleteRow) deleteRow.style.display = 'none';
    }
  } catch (e) {}
}


// ── Processing ─────────────────────────────────────
async function startProcessing() {
  const url = document.getElementById('url-input').value.trim();
  if (!url && !selectedSourceVideo) return;

  const numClips = parseInt(document.getElementById('clip-count').value) || 5;
  const subtitleLang = document.getElementById('subtitle-lang').value;

  showPage('processing');
  resetProcessingUI();

  try {
    let resp;
    if (selectedSourceVideo) {
      const formData = new FormData();
      formData.append('file', selectedSourceVideo);
      formData.append('num_clips', String(numClips));
      formData.append('title', selectedSourceVideo.name.replace(/\.[^.]+$/, ''));
      resp = await fetch('/api/source/upload', {method: 'POST', body: formData});
    } else {
      resp = await fetch('/api/process/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url, num_clips: numClips, subtitle_lang: subtitleLang}),
      });
    }
    const data = await resp.json();

    if (data.error) {
      showToast(data.error, 'error');
      showPage('home');
      return;
    }

    currentJobId = data.job_id;
  } catch (e) {
    showToast('Gagal memulai proses', 'error');
    showPage('home');
  }
}

function resetProcessingUI() {
  document.getElementById('processing-progress').style.width = '0%';
  document.getElementById('processing-status').textContent = 'Memulai...';
  document.getElementById('processing-log').textContent = '';
  document.getElementById('cancel-btn').disabled = false;
  document.getElementById('back-home-btn').disabled = true;

  document.querySelectorAll('.progress-step').forEach(s => {
    s.classList.remove('active', 'done');
  });
}

function updateProcessingProgress(step, progress) {
  document.getElementById('processing-status').textContent = step;
  document.getElementById('processing-progress').style.width = (progress * 100) + '%';

  // Update step indicators
  if (progress < 0.3) {
    document.getElementById('step-download').classList.add('active');
  } else if (progress < 1.0) {
    document.getElementById('step-download').classList.remove('active');
    document.getElementById('step-download').classList.add('done');
    document.getElementById('step-highlights').classList.add('active');
  } else {
    document.querySelectorAll('.progress-step').forEach(s => {
      s.classList.remove('active');
      s.classList.add('done');
    });
  }
}

function appendLog(msg) {
  // Append to whichever log is visible
  const procLog = document.getElementById('processing-log');
  const clipLog = document.getElementById('clip-log');
  const activePage = document.querySelector('.page.active');

  let target = procLog;
  if (activePage && activePage.id === 'page-clipping') target = clipLog;

  target.textContent += msg + '\n';
  target.scrollTop = target.scrollHeight;
}

async function cancelJob() {
  if (!currentJobId) return;
  try {
    await fetch(`/api/job/${currentJobId}/cancel`, {method: 'POST'});
    showToast('Pekerjaan dibatalkan', 'info');
    document.getElementById('back-home-btn').disabled = false;
    document.getElementById('clip-back-btn').disabled = false;
  } catch (e) {}
}


// ── Highlight Selection ────────────────────────────
function showHighlightSelection() {
  showPage('highlights');
  renderHighlights();
}

function renderHighlights() {
  const container = document.getElementById('highlight-list');
  container.innerHTML = '';

  highlights.forEach((h, i) => {
    const score = h.virality_score || 0;
    let vClass = 'virality-low';
    let vIcon = '💫';
    if (score >= 7) { vClass = 'virality-high'; vIcon = '🔥'; }
    else if (score >= 5) { vClass = 'virality-mid'; vIcon = '⚡'; }

    const duration = calcDuration(h.start_time, h.end_time);

    const div = document.createElement('div');
    div.className = 'highlight-item selected';
    div.dataset.index = i;
    div.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      toggleHighlight(i);
    };

    div.innerHTML = `
      <input type="checkbox" checked data-idx="${i}" onchange="toggleHighlight(${i})">
      <div class="highlight-info">
        <div class="highlight-title">${h.title || 'Tanpa Judul'}</div>
        <div style="font-size:12px; color:var(--text-secondary); margin:4px 0;">${h.hook_text || ''}</div>
        <div class="highlight-meta">
          <span class="virality-badge ${vClass}">${vIcon} ${score}/10</span>
          <span>⏱ ${h.start_time} → ${h.end_time}</span>
          <span>📏 ${duration}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${h.description || ''}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

function toggleHighlight(idx) {
  const items = document.querySelectorAll('.highlight-item');
  const item = items[idx];
  if (!item) return;
  const cb = item.querySelector('input[type="checkbox"]');
  cb.checked = !cb.checked;
  item.classList.toggle('selected', cb.checked);
}

function selectAllHighlights() {
  document.querySelectorAll('.highlight-item').forEach(item => {
    item.classList.add('selected');
    item.querySelector('input[type="checkbox"]').checked = true;
  });
}

function deselectAllHighlights() {
  document.querySelectorAll('.highlight-item').forEach(item => {
    item.classList.remove('selected');
    item.querySelector('input[type="checkbox"]').checked = false;
  });
}

function calcDuration(start, end) {
  const toSec = (t) => {
    const parts = t.replace(/,/g, '.').split(':');
    let s = 0;
    if (parts.length === 3) s = parseInt(parts[0])*3600 + parseInt(parts[1])*60 + parseFloat(parts[2]);
    else if (parts.length === 2) s = parseInt(parts[0])*60 + parseFloat(parts[1]);
    else s = parseFloat(parts[0]);
    return s;
  };
  const dur = toSec(end) - toSec(start);
  const mins = Math.floor(dur / 60);
  const secs = Math.floor(dur % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}


// ── Process Selected Clips ─────────────────────────
async function processSelected() {
  if (!currentSessionData) return;

  const selected = [];
  document.querySelectorAll('.highlight-item input[type="checkbox"]').forEach((cb, i) => {
    if (cb.checked) selected.push(i);
  });

  if (selected.length === 0) {
    showToast('Pilih minimal satu highlight', 'error');
    return;
  }

  const addCaptions = document.getElementById('toggle-captions').checked;
  const addHook = document.getElementById('toggle-hook').checked;
  const addPublishPack = document.getElementById('toggle-publish-pack').checked;

  showPage('clipping');
  resetClipUI();

  try {
    const resp = await fetch('/api/clip/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        job_id: currentSessionData.job_id,
        session_id: currentSessionData.session_id,
        selected: selected,
        add_captions: addCaptions,
        add_hook: addHook,
        add_publish_pack: addPublishPack,
      }),
    });
    const data = await resp.json();

    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    currentJobId = data.job_id;
  } catch (e) {
    showToast('Gagal memulai pemotongan klip', 'error');
  }
}

function resetClipUI() {
  document.getElementById('clip-progress').style.width = '0%';
  document.getElementById('clip-current').textContent = 'Mempersiapkan...';
  document.getElementById('clip-count-text').textContent = '0 / 0 klip diproses';
  document.getElementById('clip-status').textContent = 'Memulai...';
  document.getElementById('clip-log').textContent = '';
  document.getElementById('clip-cancel-btn').disabled = false;
  document.getElementById('clip-back-btn').disabled = true;
  document.getElementById('clip-sessions-btn').disabled = true;
}

function updateClipProgress(step, progress) {
  document.getElementById('clip-status').textContent = step;
  document.getElementById('clip-progress').style.width = (progress * 100) + '%';
}


// ── Sessions/Browse ────────────────────────────────
async function loadSessions() {
  const container = document.getElementById('sessions-list');
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">Memuat...</div></div>';

  try {
    const resp = await fetch('/api/sessions');
    const sessions = await resp.json();

    if (!sessions.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">Belum ada sesi. Mulai proses video terlebih dahulu!</div></div>';
      return;
    }

    container.innerHTML = '';
    sessions.forEach(session => {
      const div = document.createElement('div');
      div.className = 'session-item';

      div.innerHTML = `
        <div class="session-header" onclick="this.nextElementSibling.classList.toggle('open')">
          <div>
            <strong>${session.name}</strong>
            <span style="font-size:11px; color:var(--text-muted); margin-left:8px;">${session.clips.length} klip</span>
          </div>
          <span style="color:var(--text-muted)">▼</span>
        </div>
        <div class="session-clips">
          ${session.clips.map(clip => `
            <div class="clip-row">
              <div class="clip-info">
                <div class="clip-title">${clip.title}</div>
                <div class="clip-meta">${clip.hook_text || ''} ${clip.duration ? '| ' + Math.round(clip.duration) + 's' : ''}</div>
                ${renderPublishPack(clip)}
              </div>
              <div class="clip-actions">
                <button class="btn btn-secondary btn-sm" onclick="playVideo('${clip.video_path.replace(/'/g, "\\'")}', '${clip.title.replace(/'/g, "\\'")}')">▶</button>
                <a class="btn btn-secondary btn-sm" href="/api/sessions/download?path=${encodeURIComponent(clip.video_path)}" download>⬇</a>
                <button class="btn btn-primary btn-sm" onclick="openPublishModal('${clip.video_path.replace(/'/g, "\\'")}', '${clip.title.replace(/'/g, "\\'")}', '${(clip.hook_text || '').replace(/'/g, "\\'")}')">📤</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Gagal memuat sesi</div></div>';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPublishPack(clip) {
  const pack = clip.publish_pack || {};
  if (!pack.title && !pack.thumbnail_path && !(pack.hashtags || []).length) return '';

  const hashtags = (pack.hashtags || []).map(tag => {
    const label = String(tag || '').startsWith('#') ? tag : `#${tag}`;
    return `<span class="publish-tag">${escapeHtml(label)}</span>`;
  }).join('');

  const thumb = pack.thumbnail_path
    ? `<img class="publish-thumb" src="/api/sessions/thumbnail?path=${encodeURIComponent(pack.thumbnail_path)}" alt="Thumbnail">`
    : '';

  return `
    <div class="publish-pack">
      ${thumb}
      <div class="publish-copy">
        <div class="publish-label">PUBLISH PACK</div>
        <div class="publish-title">${escapeHtml(pack.title || clip.title)}</div>
        ${pack.description ? `<div class="publish-description">${escapeHtml(pack.description)}</div>` : ''}
        ${hashtags ? `<div class="publish-tags">${hashtags}</div>` : ''}
      </div>
    </div>
  `;
}


// ── Video Player ───────────────────────────────────
function playVideo(path, title) {
  const modal = document.getElementById('video-modal');
  const video = document.getElementById('modal-video');
  const titleEl = document.getElementById('modal-title');

  titleEl.textContent = title || 'Video';
  video.src = `/api/sessions/video?path=${encodeURIComponent(path)}`;
  modal.classList.add('active');
  video.play();
}

function closeVideoModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const modal = document.getElementById('video-modal');
  const video = document.getElementById('modal-video');
  video.pause();
  video.src = '';
  modal.classList.remove('active');
}


// ── Settings ───────────────────────────────────────
function openSettingsSubpage(key) {
  document.getElementById('settings-main').style.display = 'none';
  document.querySelectorAll('.settings-subpage').forEach(sp => sp.classList.remove('active'));
  const subpage = document.getElementById('settings-' + key);
  if (subpage) subpage.classList.add('active');
  if (key === 'publish') {
    loadYouTubePublishStatus();
    loadTikTokPublishStatus();
  }
}

function closeSettingsSubpage() {
  document.querySelectorAll('.settings-subpage').forEach(sp => sp.classList.remove('active'));
  document.getElementById('settings-main').style.display = 'block';
}

async function loadSettingsData() {
  // Load providers list
  try {
    const resp = await fetch('/api/providers');
    providers = await resp.json();
    populateProviderSelector();
  } catch (e) {}

  // Load current AI settings
  try {
    const resp = await fetch('/api/config/ai_providers');
    const data = await resp.json();
    populateAiFields(data);
  } catch (e) {}

  // Load performance settings
  try {
    const resp = await fetch('/api/settings/performance');
    const data = await resp.json();
    document.getElementById('face-tracking-mode').value = data.face_tracking_mode || 'opencv';
    if (data.mediapipe_settings) {
      document.getElementById('mp-lip-threshold').value = data.mediapipe_settings.lip_activity_threshold || 0.15;
      document.getElementById('mp-switch-threshold').value = data.mediapipe_settings.switch_threshold || 0.3;
      document.getElementById('mp-min-shot').value = data.mediapipe_settings.min_shot_duration || 90;
      document.getElementById('mp-center-weight').value = data.mediapipe_settings.center_weight || 0.3;
    }
    document.getElementById('gpu-enabled').checked = (data.gpu_acceleration || {}).enabled || false;
  } catch (e) {}

  // Load output settings
  try {
    const resp = await fetch('/api/settings/output');
    const data = await resp.json();
    document.getElementById('output-dir').value = data.output_dir || '';
    document.getElementById('system-prompt').value = data.system_prompt || '';
    document.getElementById('temperature').value = data.temperature || 1.0;
    document.getElementById('min-clip-duration').value = data.min_clip_duration ?? 58;
    document.getElementById('max-clip-duration').value = data.max_clip_duration ?? 120;
  } catch (e) {}

  // Load watermark settings
  try {
    const resp = await fetch('/api/settings/watermark');
    const data = await resp.json();
    document.getElementById('wm-enabled').checked = data.enabled || false;
    document.getElementById('wm-path').value = data.image_path || '';
    document.getElementById('wm-x').value = data.position_x || 0.85;
    document.getElementById('wm-y').value = data.position_y || 0.05;
    document.getElementById('wm-opacity').value = data.opacity || 0.8;
    document.getElementById('wm-scale').value = data.scale || 0.15;
  } catch (e) {}

  // Load credit watermark
  try {
    const resp = await fetch('/api/settings/credit_watermark');
    const data = await resp.json();
    document.getElementById('cw-enabled').checked = data.enabled || false;
  } catch (e) {}
}

function populateProviderSelector() {
  const select = document.getElementById('provider-type');
  select.innerHTML = '';
  providers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
}

function populateAiFields(data) {
  const hf = data.highlight_finder || {};
  const cm = data.caption_maker || {};
  const hm = data.hook_maker || {};
  const tg = data.youtube_title_maker || {};

  document.getElementById('hf-base-url').value = hf.base_url || '';
  document.getElementById('hf-api-key').value = hf.api_key || '';
  setSelectValue('hf-model', hf.model || 'gpt-4.1');

  document.getElementById('cm-base-url').value = cm.base_url || '';
  document.getElementById('cm-api-key').value = cm.api_key || '';
  setSelectValue('cm-model', cm.model || 'whisper-1');

  document.getElementById('hm-base-url').value = hm.base_url || '';
  document.getElementById('hm-api-key').value = hm.api_key || '';
  setSelectValue('hm-model', hm.model || 'tts-1');

  document.getElementById('tg-base-url').value = tg.base_url || '';
  document.getElementById('tg-api-key').value = tg.api_key || '';
  setSelectValue('tg-model', tg.model || 'gpt-4.1');
}

function setSelectValue(id, value) {
  const select = document.getElementById(id);
  // Check if option exists, if not add it
  let found = false;
  for (const opt of select.options) {
    if (opt.value === value) { found = true; break; }
  }
  if (!found) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  }
  select.value = value;
}

function onProviderTypeChange() {
  const key = document.getElementById('provider-type').value;
  const provider = providers.find(p => p.key === key);
  if (!provider) return;

  const baseUrl = provider.base_url;
  document.getElementById('hf-base-url').value = baseUrl;
  document.getElementById('cm-base-url').value = baseUrl;
  document.getElementById('hm-base-url').value = baseUrl;
  document.getElementById('tg-base-url').value = baseUrl;
}

async function loadModels(prefix) {
  const baseUrl = document.getElementById(prefix + '-base-url').value;
  const apiKey = document.getElementById(prefix + '-api-key').value;

  if (!baseUrl) {
    showToast('Masukkan Base URL terlebih dahulu', 'error');
    return;
  }

  try {
    const resp = await fetch('/api/providers/models', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({base_url: baseUrl, api_key: apiKey}),
    });
    const data = await resp.json();

    if (data.error) {
      showToast(`Error: ${data.error}`, 'error');
      return;
    }

    const select = document.getElementById(prefix + '-model');
    const currentVal = select.value;
    select.innerHTML = '';

    (data.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    // Restore previous value if available
    if (currentVal) setSelectValue(prefix + '-model', currentVal);
    showToast(`${data.models.length} model dimuat`, 'success');
  } catch (e) {
    showToast('Gagal memuat model', 'error');
  }
}

async function validateAllKeys() {
  const modules = [
    {prefix: 'hf', name: 'Highlight Finder'},
    {prefix: 'cm', name: 'Caption Maker'},
    {prefix: 'hm', name: 'Hook Maker'},
    {prefix: 'tg', name: 'Title Generator'},
  ];

  for (const mod of modules) {
    const baseUrl = document.getElementById(mod.prefix + '-base-url').value;
    const apiKey = document.getElementById(mod.prefix + '-api-key').value;

    if (!baseUrl || !apiKey) continue;

    try {
      const resp = await fetch('/api/validate_key', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({base_url: baseUrl, api_key: apiKey}),
      });
      const data = await resp.json();
      showToast(`${mod.name}: ${data.status === 'ok' ? 'Valid' : data.message}`, data.status === 'ok' ? 'success' : 'error');
    } catch (e) {
      showToast(`${mod.name}: Error koneksi`, 'error');
    }
  }
}

async function saveAiSettings() {
  const settings = {
    highlight_finder: {
      base_url: document.getElementById('hf-base-url').value,
      api_key: document.getElementById('hf-api-key').value,
      model: document.getElementById('hf-model').value,
    },
    caption_maker: {
      base_url: document.getElementById('cm-base-url').value,
      api_key: document.getElementById('cm-api-key').value,
      model: document.getElementById('cm-model').value,
    },
    hook_maker: {
      base_url: document.getElementById('hm-base-url').value,
      api_key: document.getElementById('hm-api-key').value,
      model: document.getElementById('hm-model').value,
    },
    youtube_title_maker: {
      base_url: document.getElementById('tg-base-url').value,
      api_key: document.getElementById('tg-api-key').value,
      model: document.getElementById('tg-model').value,
    },
    _provider_type: document.getElementById('provider-type').value,
  };

  try {
    const resp = await fetch('/api/config/ai_providers', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(settings),
    });
    const data = await resp.json();
    showToast('Pengaturan AI tersimpan!', 'success');
  } catch (e) {
    showToast('Gagal menyimpan', 'error');
  }
}

async function savePerformanceSettings() {
  const data = {
    face_tracking_mode: document.getElementById('face-tracking-mode').value,
    mediapipe_settings: {
      lip_activity_threshold: parseFloat(document.getElementById('mp-lip-threshold').value),
      switch_threshold: parseFloat(document.getElementById('mp-switch-threshold').value),
      min_shot_duration: parseInt(document.getElementById('mp-min-shot').value),
      center_weight: parseFloat(document.getElementById('mp-center-weight').value),
    },
    gpu_acceleration: {
      enabled: document.getElementById('gpu-enabled').checked,
    },
  };

  try {
    await fetch('/api/settings/performance', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    showToast('Pengaturan performa tersimpan!', 'success');
  } catch (e) {
    showToast('Gagal menyimpan', 'error');
  }
}

async function saveOutputSettings() {
  const minDur = parseInt(document.getElementById('min-clip-duration').value, 10);
  const maxDur = parseInt(document.getElementById('max-clip-duration').value, 10);
  if (Number.isFinite(minDur) && Number.isFinite(maxDur) && minDur >= maxDur) {
    showToast('Min durasi klip harus lebih kecil dari Max', 'error');
    return;
  }
  const data = {
    output_dir: document.getElementById('output-dir').value,
    system_prompt: document.getElementById('system-prompt').value,
    temperature: parseFloat(document.getElementById('temperature').value),
    min_clip_duration: Number.isFinite(minDur) ? minDur : 58,
    max_clip_duration: Number.isFinite(maxDur) ? maxDur : 120,
  };

  try {
    await fetch('/api/settings/output', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    showToast('Pengaturan output tersimpan!', 'success');
  } catch (e) {
    showToast('Gagal menyimpan', 'error');
  }
}

async function saveWatermarkSettings() {
  const data = {
    enabled: document.getElementById('wm-enabled').checked,
    image_path: document.getElementById('wm-path').value,
    position_x: parseFloat(document.getElementById('wm-x').value),
    position_y: parseFloat(document.getElementById('wm-y').value),
    opacity: parseFloat(document.getElementById('wm-opacity').value),
    scale: parseFloat(document.getElementById('wm-scale').value),
  };

  try {
    await fetch('/api/settings/watermark', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    showToast('Pengaturan watermark tersimpan!', 'success');
  } catch (e) {
    showToast('Gagal menyimpan', 'error');
  }
}

async function saveCreditWatermarkSettings() {
  const data = {
    enabled: document.getElementById('cw-enabled').checked,
  };

  try {
    await fetch('/api/settings/credit_watermark', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    showToast('Pengaturan credit watermark tersimpan!', 'success');
  } catch (e) {
    showToast('Gagal menyimpan', 'error');
  }
}

async function uploadWatermark(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const resp = await fetch('/api/watermark/upload', {method: 'POST', body: formData});
    const data = await resp.json();
    if (data.path) {
      document.getElementById('wm-path').value = data.path;
      showToast('Watermark berhasil di-upload!', 'success');
    }
  } catch (e) {
    showToast('Upload gagal', 'error');
  }
}


// ── Status Page ────────────────────────────────────
async function loadLibStatus() {
  const grid = document.getElementById('lib-grid');
  grid.innerHTML = '<div class="lib-item"><div class="lib-icon">⏳</div><div class="lib-name">Memuat...</div></div>';

  try {
    const resp = await fetch('/api/lib/status');
    const data = await resp.json();

    grid.innerHTML = '';

    const libs = [
      {key: 'ffmpeg', name: 'FFmpeg', icon: '🎬'},
      {key: 'ytdlp', name: 'yt-dlp', icon: '📥'},
      {key: 'deno', name: 'Deno', icon: '🦕'},
    ];

    libs.forEach(lib => {
      const info = data[lib.key] || {};
      const installable = ['ffmpeg', 'deno'];
      const div = document.createElement('div');
      div.className = 'lib-item';
      let btnHtml = '';
      if (!info.available && installable.includes(lib.key)) {
        btnHtml = `<button class="btn btn-primary btn-sm" style="margin-top:6px;font-size:0.8em" onclick="installLib('${lib.key}', this)">Download</button>`;
      }
      div.innerHTML = `
        <div class="lib-icon">${info.available ? lib.icon : '❌'}</div>
        <div class="lib-name">${lib.name}</div>
        <div class="lib-version" style="color:${info.available ? 'var(--green)' : 'var(--red)'}">
          ${info.available ? (info.version || 'Tersedia') : 'Tidak ditemukan'}
        </div>
        ${btnHtml}
      `;
      grid.appendChild(div);
    });

    // Update home lib status
    const homeStatus = document.getElementById('home-lib-status');
    const allOk = data.ffmpeg?.available && data.ytdlp?.available;
    homeStatus.innerHTML = allOk
      ? '<span style="color:var(--green)">Library: Siap</span>'
      : '<span style="color:var(--red)">Sebagian library belum tersedia. <a href="#" onclick="showPage(\'status\'); return false;" style="color:var(--accent)">Cek status</a></span>';

  } catch (e) {
    grid.innerHTML = '<div class="lib-item"><div class="lib-icon">⚠️</div><div class="lib-name">Gagal memuat</div></div>';
  }
}


// ── About / Updates ────────────────────────────────
async function checkUpdate() {
  const el = document.getElementById('update-status');
  el.textContent = 'Mengecek...';

  try {
    const resp = await fetch('/api/version/check');
    const data = await resp.json();
    if (data.update_available) {
      el.innerHTML = `Update tersedia: v${data.latest} <a href="${data.download_url}" target="_blank" class="btn btn-primary btn-sm" style="margin-left:8px">Download</a>`;
    } else {
      el.textContent = 'Anda sudah memakai versi terbaru!';
    }
  } catch (e) {
    el.textContent = 'Gagal mengecek update';
  }
}


// ── Library Install ────────────────────────────────
async function installLib(name, btn) {
  btn.disabled = true;
  btn.textContent = 'Downloading...';

  try {
    const resp = await fetch(`/api/lib/install/${name}`, {method: 'POST'});
    const data = await resp.json();
    if (data.status === 'ok') {
      showToast(`${name} berhasil diinstall!`, 'success');
      loadLibStatus();
    } else {
      showToast(`Gagal install ${name}: ${data.message}`, 'error');
      btn.disabled = false;
      btn.textContent = 'Download';
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Download';
  }
}


// ── Toast Notifications ────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


// ── Auto Publish (YouTube & TikTok) ────────────────

// Socket events for publish progress
socket.on('publish_progress', (data) => {
  const bar = document.getElementById('pub-progress-bar');
  const text = document.getElementById('pub-progress-text');
  if (bar) bar.style.width = data.progress + '%';
  if (text) text.textContent = `Uploading ke ${data.platform}... ${data.progress}%`;
});

socket.on('publish_complete', (data) => {
  const section = document.getElementById('pub-progress-section');
  const btn = document.getElementById('pub-upload-btn');
  const text = document.getElementById('pub-progress-text');

  if (data.result && data.result.success) {
    if (text) text.textContent = 'Upload berhasil!';
    showToast(`Upload ke ${data.platform} berhasil!${data.result.url ? ' ' + data.result.url : ''}`, 'success');
    setTimeout(() => closePublishModal(), 2000);
  } else {
    const errMsg = (data.result && data.result.error) || 'Upload gagal';
    if (text) text.textContent = errMsg;
    showToast(`Gagal upload ke ${data.platform}: ${errMsg}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Upload Sekarang'; }
  }
});

socket.on('youtube_auth_result', (data) => {
  if (data.success) {
    showToast('YouTube terhubung!', 'success');
    loadYouTubePublishStatus();
  } else {
    showToast('Gagal menghubungkan YouTube: ' + (data.error || ''), 'error');
  }
});

socket.on('tiktok_auth_result', (data) => {
  if (data.success) {
    showToast('TikTok terhubung!', 'success');
    loadTikTokPublishStatus();
  } else {
    showToast('Gagal menghubungkan TikTok: ' + (data.error || ''), 'error');
  }
});

// ── YouTube Publish Functions ──────────────────────
async function loadYouTubePublishStatus() {
  try {
    const resp = await fetch('/api/publish/youtube/status');
    const data = await resp.json();
    const statusEl = document.getElementById('yt-publish-status');
    const infoEl = document.getElementById('yt-channel-info');
    const connectBtn = document.getElementById('yt-connect-btn');
    const disconnectBtn = document.getElementById('yt-disconnect-btn');

    if (!data.available) {
      statusEl.innerHTML = '<span class="status-dot red"></span><span>Module tidak tersedia</span>';
      if (connectBtn) connectBtn.style.display = 'none';
      return;
    }

    if (data.authenticated && data.channel) {
      statusEl.innerHTML = '<span class="status-dot green"></span><span>Terhubung</span>';
      if (infoEl) {
        infoEl.style.display = 'block';
        document.getElementById('yt-channel-name').textContent = data.channel.title || '';
        document.getElementById('yt-channel-subs').textContent = (data.channel.subscribers || '0') + ' subscribers';
        const thumb = document.getElementById('yt-channel-thumb');
        if (data.channel.thumbnail) thumb.src = data.channel.thumbnail;
        else thumb.style.display = 'none';
      }
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
    } else if (data.configured) {
      statusEl.innerHTML = '<span class="status-dot yellow"></span><span>Belum login</span>';
      if (infoEl) infoEl.style.display = 'none';
      if (connectBtn) connectBtn.style.display = 'inline-flex';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
    } else {
      statusEl.innerHTML = '<span class="status-dot red"></span><span>client_secret.json belum ada</span>';
      if (infoEl) infoEl.style.display = 'none';
      if (connectBtn) connectBtn.style.display = 'inline-flex';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
    }
  } catch (e) {
    console.error('Failed to load YouTube publish status:', e);
  }
}

async function connectYouTube() {
  const btn = document.getElementById('yt-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';

  try {
    const resp = await fetch('/api/publish/youtube/auth/start', { method: 'POST' });
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, 'error');
      if (data.setup_guide) showToast(data.setup_guide, 'info');
    } else {
      showToast(data.message || 'Browser terbuka untuk login YouTube...', 'info');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = '🔗 Hubungkan YouTube';
}

async function disconnectYouTube() {
  if (!confirm('Putuskan koneksi YouTube?')) return;
  try {
    await fetch('/api/publish/youtube/disconnect', { method: 'POST' });
    showToast('YouTube terputus', 'info');
    loadYouTubePublishStatus();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── TikTok Publish Functions ──────────────────────
async function loadTikTokPublishStatus() {
  try {
    const resp = await fetch('/api/publish/tiktok/status');
    const data = await resp.json();
    const statusEl = document.getElementById('tt-publish-status');
    const infoEl = document.getElementById('tt-user-info');
    const connectBtn = document.getElementById('tt-connect-btn');
    const disconnectBtn = document.getElementById('tt-disconnect-btn');

    if (!data.available) {
      statusEl.innerHTML = '<span class="status-dot red"></span><span>Module tidak tersedia</span>';
      if (connectBtn) connectBtn.style.display = 'none';
      return;
    }

    if (data.authenticated && data.user) {
      statusEl.innerHTML = '<span class="status-dot green"></span><span>Terhubung</span>';
      if (infoEl) {
        infoEl.style.display = 'block';
        document.getElementById('tt-user-name').textContent = data.user.display_name || 'TikTok User';
        document.getElementById('tt-mode-badge').textContent = data.mode === 'sandbox' ? 'Sandbox Mode' : 'Production';
        const avatar = document.getElementById('tt-user-avatar');
        if (data.user.avatar_url) avatar.src = data.user.avatar_url;
        else avatar.style.display = 'none';
      }
      if (connectBtn) connectBtn.style.display = 'none';
      if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
    } else if (data.configured) {
      statusEl.innerHTML = '<span class="status-dot yellow"></span><span>Belum login</span>';
      if (infoEl) infoEl.style.display = 'none';
      if (connectBtn) connectBtn.style.display = 'inline-flex';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
    } else {
      statusEl.innerHTML = '<span class="status-dot red"></span><span>Credentials belum dikonfigurasi</span>';
      if (infoEl) infoEl.style.display = 'none';
      if (connectBtn) connectBtn.style.display = 'inline-flex';
      if (disconnectBtn) disconnectBtn.style.display = 'none';
    }

    // Load saved credentials into form
    const ttConfig = (await (await fetch('/api/config')).json()).tiktok || {};
    if (ttConfig.client_key) document.getElementById('tt-client-key').value = ttConfig.client_key;
  } catch (e) {
    console.error('Failed to load TikTok publish status:', e);
  }
}

async function saveTikTokConfig() {
  const clientKey = document.getElementById('tt-client-key').value.trim();
  const clientSecret = document.getElementById('tt-client-secret').value.trim();

  if (!clientKey || !clientSecret) {
    showToast('Client Key dan Client Secret wajib diisi', 'error');
    return;
  }

  try {
    const resp = await fetch('/api/publish/tiktok/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_key: clientKey, client_secret: clientSecret }),
    });
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, 'error');
    } else {
      showToast('TikTok credentials tersimpan!', 'success');
      loadTikTokPublishStatus();
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function connectTikTok() {
  const btn = document.getElementById('tt-connect-btn');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';

  try {
    const resp = await fetch('/api/publish/tiktok/auth/start', { method: 'POST' });
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, 'error');
      if (data.setup_guide) showToast(data.setup_guide, 'info');
    } else {
      showToast(data.message || 'Browser terbuka untuk otorisasi TikTok...', 'info');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = '🔗 Hubungkan TikTok';
}

async function disconnectTikTok() {
  if (!confirm('Putuskan koneksi TikTok?')) return;
  try {
    await fetch('/api/publish/tiktok/disconnect', { method: 'POST' });
    showToast('TikTok terputus', 'info');
    loadTikTokPublishStatus();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

// ── Publish Modal ─────────────────────────────────
function openPublishModal(videoPath, title, hookText) {
  document.getElementById('pub-video-path').value = videoPath;
  document.getElementById('pub-hook-text').value = hookText || '';
  document.getElementById('pub-title').value = title || '';
  document.getElementById('pub-description').value = '';
  document.getElementById('pub-tags').value = 'shorts, viral, fyp';
  document.getElementById('pub-platform').value = 'youtube';
  document.getElementById('pub-privacy').value = 'private';
  document.getElementById('pub-progress-section').style.display = 'none';
  document.getElementById('pub-upload-btn').disabled = false;
  document.getElementById('pub-upload-btn').textContent = '📤 Upload Sekarang';
  updatePubTitleCount();
  onPublishPlatformChange();
  document.getElementById('publish-modal').classList.add('active');
}

function closePublishModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('publish-modal').classList.remove('active');
}

function updatePubTitleCount() {
  const input = document.getElementById('pub-title');
  const count = document.getElementById('pub-title-count');
  const platform = document.getElementById('pub-platform').value;
  const max = platform === 'tiktok' ? 150 : 100;
  input.maxLength = max;
  count.textContent = `${(input.value || '').length}/${max}`;
}

function onPublishPlatformChange() {
  const platform = document.getElementById('pub-platform').value;
  const descGroup = document.getElementById('pub-desc-group');
  const tagsGroup = document.getElementById('pub-tags-group');
  const seoGroup = document.getElementById('pub-seo-group');
  const privacySelect = document.getElementById('pub-privacy');

  if (platform === 'tiktok') {
    descGroup.style.display = 'none';
    tagsGroup.style.display = 'none';
    seoGroup.style.display = 'none';
    // TikTok privacy options
    privacySelect.innerHTML = `
      <option value="SELF_ONLY">Private (Hanya Saya)</option>
      <option value="MUTUAL_FOLLOW_FRIENDS">Teman</option>
      <option value="FOLLOWER_OF_CREATOR">Pengikut</option>
      <option value="PUBLIC_TO_EVERYONE">Publik</option>
    `;
  } else {
    descGroup.style.display = 'block';
    tagsGroup.style.display = 'block';
    seoGroup.style.display = 'block';
    privacySelect.innerHTML = `
      <option value="private">Private</option>
      <option value="unlisted">Unlisted</option>
      <option value="public">Public</option>
    `;
  }
  updatePubTitleCount();
}

async function generateSeoMetadata() {
  const title = document.getElementById('pub-title').value;
  const hookText = document.getElementById('pub-hook-text').value;
  if (!title) { showToast('Judul wajib diisi', 'error'); return; }

  showToast('Generating SEO metadata...', 'info');
  try {
    const resp = await fetch('/api/publish/youtube/seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, hook_text: hookText }),
    });
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, 'error');
      return;
    }
    if (data.title) document.getElementById('pub-title').value = data.title;
    if (data.description) document.getElementById('pub-description').value = data.description;
    if (data.tags) document.getElementById('pub-tags').value = data.tags.join(', ');
    updatePubTitleCount();
    showToast('SEO metadata di-generate!', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function doPublishUpload() {
  const platform = document.getElementById('pub-platform').value;
  const videoPath = document.getElementById('pub-video-path').value;
  const title = document.getElementById('pub-title').value.trim();
  const privacy = document.getElementById('pub-privacy').value;
  const btn = document.getElementById('pub-upload-btn');

  if (!title) { showToast('Judul wajib diisi', 'error'); return; }

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  document.getElementById('pub-progress-section').style.display = 'block';
  document.getElementById('pub-progress-bar').style.width = '0%';

  const endpoint = platform === 'tiktok' ? '/api/publish/tiktok/upload' : '/api/publish/youtube/upload';
  const body = { video_path: videoPath, title, privacy };

  if (platform === 'youtube') {
    body.description = document.getElementById('pub-description').value;
    body.tags = document.getElementById('pub-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, 'error');
      btn.disabled = false;
      btn.textContent = '📤 Upload Sekarang';
      document.getElementById('pub-progress-section').style.display = 'none';
    }
    // Progress updates come via socket
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '📤 Upload Sekarang';
    document.getElementById('pub-progress-section').style.display = 'none';
  }
}

// ── Load Publish Status on Settings Open ──────────
const _origOpenSettingsSubpage = typeof openSettingsSubpage !== 'undefined' ? openSettingsSubpage : null;

// Attach pub-title counter
document.addEventListener('DOMContentLoaded', () => {
  const pubTitle = document.getElementById('pub-title');
  if (pubTitle) pubTitle.addEventListener('input', updatePubTitleCount);
});


// ── Init ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkCookiesStatus();
  loadLibStatus();
});
