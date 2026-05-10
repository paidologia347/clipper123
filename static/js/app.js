/* ═══════════════════════════════════════════════════
   YT Short Clipper Web – Client Application
   ═══════════════════════════════════════════════════ */

// ── Socket.IO ──────────────────────────────────────
const socket = io();
let currentJobId = null;
let currentSessionData = null;
let highlights = [];
let providers = [];
let socialClips = [];
let selectedSocialClipIndex = null;

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
      transcript: data.transcript || '',
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
    if (el) el.textContent = `Clip ${data.current}/${data.total}: ${data.title}`;
    const ct = document.getElementById('clip-count-text');
    if (ct) ct.textContent = `${data.current} / ${data.total} clips processed`;
  }
});

socket.on('clipping_complete', (data) => {
  if (data.job_id === currentJobId) {
    showToast(`${data.clips_count} clips created!`, 'success');
    document.getElementById('clip-cancel-btn').disabled = true;
    document.getElementById('clip-back-btn').disabled = false;
    document.getElementById('clip-sessions-btn').disabled = false;
    document.getElementById('clip-status').textContent = 'All clips created!';
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
  if (name === 'social') loadSocialStudio();
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
      '<div class="placeholder"><div style="font-size:36px; margin-bottom:8px">🎬</div><div>Paste a YouTube URL to see preview</div></div>';
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
    setSourceUploadStatus('idle', 'Select a video to upload');
    if (!document.getElementById('url-input').value.trim()) {
      document.getElementById('start-btn').disabled = true;
    }
    return;
  }

  nameEl.textContent = `${file.name} (${Math.round(file.size / 1024 / 1024)} MB)`;
  setSourceUploadStatus('ready', 'Ready to upload when you click Find Highlights');
  document.getElementById('start-btn').disabled = false;
  document.getElementById('thumbnail-preview').innerHTML =
    '<div class="placeholder"><div style="font-size:36px; margin-bottom:8px">🎞</div><div>Uploaded video selected</div></div>';
  document.getElementById('video-title').textContent = file.name;
}

function setSourceUploadStatus(state, message) {
  const el = document.getElementById('source-upload-status');
  if (!el) return;
  el.className = `upload-status ${state}`;
  el.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(message)}</span>`;
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
        `<img src="${data.thumbnail}" onerror="this.parentElement.innerHTML='<div class=placeholder>No thumbnail</div>'">`;
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
    showToast('Cannot access clipboard', 'error');
  }
}


// ── Cookies ────────────────────────────────────────
async function uploadCookies(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const resp = await fetch('/api/cookies/upload', {method: 'POST', body: formData});
    const data = await resp.json();
    if (data.status === 'ok') {
      showToast('Cookies uploaded!', 'success');
      checkCookiesStatus();
    }
  } catch (e) {
    showToast('Upload failed', 'error');
  }
}

async function checkCookiesStatus() {
  try {
    const resp = await fetch('/api/cookies/status');
    const data = await resp.json();
    const el = document.getElementById('cookies-status');
    if (data.has_cookies) {
      el.innerHTML = `<span class="status-dot green"></span><span>Cookies loaded (${data.count} entries)</span>`;
    } else {
      el.innerHTML = '<span class="status-dot red"></span><span>No cookies</span>';
    }
  } catch (e) {}
}


// ── Processing ─────────────────────────────────────
async function startProcessing() {
  const url = document.getElementById('url-input').value.trim();
  const externalUrl = document.getElementById('external-source-url')?.value.trim() || '';
  if (!url && !selectedSourceVideo && !externalUrl) return;

  const numClips = parseInt(document.getElementById('clip-count').value) || 5;
  const subtitleLang = document.getElementById('subtitle-lang').value;

  showPage('processing');
  resetProcessingUI();

  try {
    let resp;
    if (selectedSourceVideo) {
      setSourceUploadStatus('uploading', 'Uploading source video...');
      const formData = new FormData();
      formData.append('file', selectedSourceVideo);
      formData.append('num_clips', String(numClips));
      formData.append('title', selectedSourceVideo.name.replace(/\.[^.]+$/, ''));
      resp = await fetch('/api/source/upload', {method: 'POST', body: formData});
    } else if (externalUrl) {
      setSourceUploadStatus('uploading', 'Importing external source video...');
      resp = await fetch('/api/source/import', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          source_url: externalUrl,
          title: document.getElementById('external-source-title')?.value || 'External source video',
          num_clips: numClips,
        }),
      });
    } else {
      resp = await fetch('/api/process/start', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url, num_clips: numClips, subtitle_lang: subtitleLang}),
      });
    }
    let data = {};
    const rawText = await resp.text();
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      data = {error: rawText || `HTTP ${resp.status}`};
    }

    if (!resp.ok || data.error) {
      const errorMessage = data.error || `HTTP ${resp.status}`;
      if (selectedSourceVideo || externalUrl) setSourceUploadStatus('error', `Source failed: ${errorMessage}`);
      showToast(errorMessage, 'error');
      showPage('home');
      return;
    }

    currentJobId = data.job_id;
    if (selectedSourceVideo || externalUrl) {
      setSourceUploadStatus('success', `Source accepted. Job ${data.job_id} is processing.`);
    }
  } catch (e) {
    const message = e && e.message ? e.message : 'Network error';
    if (selectedSourceVideo || externalUrl) setSourceUploadStatus('error', `Source failed: ${message}`);
    showToast('Failed to start processing', 'error');
    showPage('home');
  }
}

function resetProcessingUI() {
  document.getElementById('processing-progress').style.width = '0%';
  document.getElementById('processing-status').textContent = 'Initializing...';
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
    showToast('Job cancelled', 'info');
    document.getElementById('back-home-btn').disabled = false;
    document.getElementById('clip-back-btn').disabled = false;
  } catch (e) {}
}


// ── Highlight Selection ────────────────────────────
function showHighlightSelection() {
  showPage('highlights');
  renderTranscriptEditor();
  renderHighlights();
}

function renderTranscriptEditor() {
  const card = document.getElementById('transcript-card');
  const editor = document.getElementById('transcript-editor');
  if (!card || !editor || !currentSessionData) return;
  const transcript = currentSessionData.transcript || '';
  if (!transcript) {
    card.style.display = 'none';
    return;
  }
  editor.value = transcript;
  card.style.display = 'block';
}

async function saveTranscript(regenerate) {
  if (!currentSessionData?.session_id) return;
  const transcript = document.getElementById('transcript-editor')?.value || '';
  const numClips = parseInt(document.getElementById('clip-count').value) || highlights.length || 5;
  try {
    const resp = await fetch(`/api/session/${encodeURIComponent(currentSessionData.session_id)}/transcript`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({transcript, regenerate, num_clips: numClips}),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      showToast(data.error || 'Failed to save transcript', 'error');
      return;
    }
    currentSessionData.transcript = data.transcript;
    if (regenerate) {
      highlights = data.highlights || [];
      currentSessionData.highlights = highlights;
      renderHighlights();
    }
    showToast(regenerate ? 'Transcript saved and highlights regenerated' : 'Transcript saved', 'success');
  } catch (e) {
    showToast('Failed to save transcript', 'error');
  }
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
        <div class="highlight-title">${h.title || 'Untitled'}</div>
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
    showToast('Select at least one highlight', 'error');
    return;
  }

  const addCaptions = document.getElementById('toggle-captions').checked;
  const addHook = document.getElementById('toggle-hook').checked;
  const addPublishPack = document.getElementById('toggle-publish-pack').checked;
  const captionStyle = document.getElementById('caption-style')?.value || 'capcut';

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
        caption_style: captionStyle,
      }),
    });
    const data = await resp.json();

    if (data.error) {
      showToast(data.error, 'error');
      return;
    }

    currentJobId = data.job_id;
  } catch (e) {
    showToast('Failed to start clipping', 'error');
  }
}

function resetClipUI() {
  document.getElementById('clip-progress').style.width = '0%';
  document.getElementById('clip-current').textContent = 'Preparing...';
  document.getElementById('clip-count-text').textContent = '0 / 0 clips processed';
  document.getElementById('clip-status').textContent = 'Initializing...';
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
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">Loading...</div></div>';

  try {
    const resp = await fetch('/api/sessions');
    const sessions = await resp.json();

    if (!sessions.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No sessions yet. Start processing a video!</div></div>';
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
            <span style="font-size:11px; color:var(--text-muted); margin-left:8px;">${session.clips.length} clips</span>
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
              </div>
            </div>
          `).join('')}
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load sessions</div></div>';
  }
}

// ── Social Studio ──────────────────────────────────
async function loadSocialStudio() {
  const list = document.getElementById('social-clip-list');
  const editor = document.getElementById('social-editor');
  if (!list || !editor) return;

  list.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><div class="empty-text">Loading clips...</div></div>';
  editor.innerHTML = '<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-text">Choose a finished clip to edit its social package</div></div>';
  selectedSocialClipIndex = null;

  try {
    const resp = await fetch('/api/sessions');
    const sessions = await resp.json();
    socialClips = [];
    sessions.forEach(session => {
      (session.clips || []).forEach(clip => {
        socialClips.push({...clip, session_name: session.name});
      });
    });

    if (!socialClips.length) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-text">No finished clips yet</div></div>';
      return;
    }

    list.innerHTML = socialClips.map((clip, idx) => `
      <button class="social-clip-btn" id="social-clip-${idx}" onclick="selectSocialClip(${idx})">
        <span class="social-clip-title">${escapeHtml(clip.title || clip.name)}</span>
        <span class="social-clip-meta">${escapeHtml(clip.session_name || '')} ${clip.duration ? `• ${Math.round(clip.duration)}s` : ''}</span>
      </button>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load clips</div></div>';
  }
}

function selectSocialClip(index) {
  selectedSocialClipIndex = index;
  document.querySelectorAll('.social-clip-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById(`social-clip-${index}`);
  if (btn) btn.classList.add('active');
  renderSocialEditor(socialClips[index]);
}

function renderSocialEditor(clip) {
  const editor = document.getElementById('social-editor');
  const pack = clip.publish_pack || {};
  const platforms = pack.platform_recommendations || {};
  const thumb = pack.thumbnail_path
    ? `/api/sessions/thumbnail?path=${encodeURIComponent(pack.thumbnail_path)}`
    : '';

  editor.innerHTML = `
    <div class="social-preview">
      <video controls src="/api/sessions/video?path=${encodeURIComponent(clip.video_path)}"></video>
      ${thumb ? `<img src="${thumb}" alt="Thumbnail">` : '<div class="social-thumb-empty">No thumbnail</div>'}
    </div>

    <div class="card">
      <div class="card-title">AI Social Package</div>
      <div class="form-grid">
        <label>Title<input id="social-title" value="${escapeAttr(pack.title || clip.title || '')}"></label>
        <label>Thumbnail Text<input id="social-thumbnail-text" value="${escapeAttr(pack.thumbnail_text || '')}"></label>
        <label class="full">Caption<textarea id="social-caption" rows="3">${escapeHtml(pack.caption || pack.description || '')}</textarea></label>
        <label class="full">Hashtags<input id="social-hashtags" value="${escapeAttr((pack.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' '))}"></label>
        <label class="full">Subtitle Direction<textarea id="social-subtitle-style" rows="2">${escapeHtml((pack.subtitle || {}).style || '')}</textarea></label>
      </div>
      <div class="btn-group" style="margin-top:12px">
        <button class="btn btn-primary btn-sm" onclick="generateSocialPack()">Generate with AI</button>
        <button class="btn btn-success btn-sm" onclick="saveSocialPack()">Save Edits</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Platform Formats</div>
      <div class="social-platform-editor">
        ${['instagram', 'tiktok', 'facebook', 'youtube'].map(platform => renderPlatformEditor(platform, platforms[platform] || {})).join('')}
      </div>
    </div>
  `;
}

function renderPlatformEditor(platform, item) {
  const label = {instagram: 'Instagram Reels', tiktok: 'TikTok', facebook: 'Facebook Reels', youtube: 'YouTube Shorts'}[platform] || platform;
  return `
    <div class="platform-edit-card" data-platform="${platform}">
      <div class="platform-name">${escapeHtml(label)}</div>
      <label>Title<input id="${platform}-title" value="${escapeAttr(item.title || '')}"></label>
      <label>Caption<textarea id="${platform}-caption" rows="3">${escapeHtml(item.caption || '')}</textarea></label>
      <label>Hashtags<input id="${platform}-hashtags" value="${escapeAttr((item.hashtags || []).map(tag => `#${String(tag).replace(/^#/, '')}`).join(' '))}"></label>
      <label>Best Time<input id="${platform}-best-time" value="${escapeAttr(item.best_time || '')}"></label>
      <label>Format<input id="${platform}-format" value="${escapeAttr(item.format || '')}"></label>
      <label>Posting Tip<textarea id="${platform}-tip" rows="2">${escapeHtml(item.posting_tip || '')}</textarea></label>
    </div>
  `;
}

function collectSocialPack() {
  const platforms = {};
  ['instagram', 'tiktok', 'facebook', 'youtube'].forEach(platform => {
    platforms[platform] = {
      title: document.getElementById(`${platform}-title`)?.value || '',
      caption: document.getElementById(`${platform}-caption`)?.value || '',
      hashtags: splitHashtags(document.getElementById(`${platform}-hashtags`)?.value || ''),
      best_time: document.getElementById(`${platform}-best-time`)?.value || '',
      format: document.getElementById(`${platform}-format`)?.value || '',
      posting_tip: document.getElementById(`${platform}-tip`)?.value || '',
    };
  });

  return {
    title: document.getElementById('social-title')?.value || '',
    caption: document.getElementById('social-caption')?.value || '',
    description: document.getElementById('social-caption')?.value || '',
    hashtags: splitHashtags(document.getElementById('social-hashtags')?.value || ''),
    thumbnail_text: document.getElementById('social-thumbnail-text')?.value || '',
    subtitle: {
      style: document.getElementById('social-subtitle-style')?.value || '',
      burned_in: true,
      language: 'id',
    },
    platform_recommendations: platforms,
  };
}

function splitHashtags(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(tag => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
}

async function generateSocialPack() {
  const clip = socialClips[selectedSocialClipIndex];
  if (!clip) return;
  showToast('Generating social recommendations...', 'success');
  const resp = await fetch('/api/social/generate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      video_path: clip.video_path,
      title: document.getElementById('social-title')?.value || clip.title,
      hook_text: clip.hook_text || clip.title,
      description: document.getElementById('social-caption')?.value || '',
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    showToast(data.error || 'Failed to generate social package', 'error');
    return;
  }
  socialClips[selectedSocialClipIndex].publish_pack = data.publish_pack;
  renderSocialEditor(socialClips[selectedSocialClipIndex]);
  showToast('Social package generated', 'success');
}

async function saveSocialPack() {
  const clip = socialClips[selectedSocialClipIndex];
  if (!clip) return;
  const pack = collectSocialPack();
  const resp = await fetch('/api/social/save', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      video_path: clip.video_path,
      title: pack.title,
      hook_text: clip.hook_text || pack.title,
      publish_pack: pack,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    showToast(data.error || 'Failed to save social package', 'error');
    return;
  }
  socialClips[selectedSocialClipIndex].publish_pack = data.publish_pack;
  socialClips[selectedSocialClipIndex].title = pack.title;
  showToast('Social package saved', 'success');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function renderPublishPack(clip) {
  const pack = clip.publish_pack || {};
  if (!pack.title && !pack.thumbnail_path && !(pack.hashtags || []).length && !pack.platform_recommendations) return '';

  const hashtags = (pack.hashtags || []).map(tag => {
    const label = String(tag || '').startsWith('#') ? tag : `#${tag}`;
    return `<span class="publish-tag">${escapeHtml(label)}</span>`;
  }).join('');

  const thumb = pack.thumbnail_path
    ? `<img class="publish-thumb" src="/api/sessions/thumbnail?path=${encodeURIComponent(pack.thumbnail_path)}" alt="Thumbnail">`
    : '';

  const subtitle = pack.subtitle || {};
  const subtitleBlock = (subtitle.opening_line || subtitle.style)
    ? `<div class="publish-section">
        <div class="publish-section-title">Subtitle</div>
        ${subtitle.opening_line ? `<div class="publish-description"><strong>Opening:</strong> ${escapeHtml(subtitle.opening_line)}</div>` : ''}
        ${subtitle.style ? `<div class="publish-description"><strong>Style:</strong> ${escapeHtml(subtitle.style)}</div>` : ''}
        <div class="publish-description"><strong>Status:</strong> ${subtitle.burned_in ? 'Burned into video' : 'Not burned in. Enable Add Captions before processing.'}</div>
      </div>`
    : '';

  const platformBlock = renderPlatformRecommendations(pack.platform_recommendations || {});

  return `
    <div class="publish-pack">
      ${thumb}
      <div class="publish-copy">
        <div class="publish-label">Publish Pack</div>
        <div class="publish-title">${escapeHtml(pack.title || clip.title)}</div>
        ${pack.caption ? `<div class="publish-description"><strong>Caption:</strong> ${escapeHtml(pack.caption)}</div>` : ''}
        ${pack.description ? `<div class="publish-description"><strong>Description:</strong> ${escapeHtml(pack.description)}</div>` : ''}
        ${hashtags ? `<div class="publish-tags">${hashtags}</div>` : ''}
        ${subtitleBlock}
        ${platformBlock}
      </div>
    </div>
  `;
}

function renderPlatformRecommendations(recommendations) {
  const entries = Object.entries(recommendations || {});
  if (!entries.length) return '';

  const labels = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    youtube: 'YouTube',
  };

  return `
    <div class="publish-section">
      <div class="publish-section-title">Posting Recommendations</div>
      <div class="platform-grid">
        ${entries.map(([key, item]) => {
          const tags = (item.hashtags || []).map(tag => {
            const label = String(tag || '').startsWith('#') ? tag : `#${tag}`;
            return `<span class="publish-tag">${escapeHtml(label)}</span>`;
          }).join('');
          return `
            <div class="platform-card">
              <div class="platform-name">${escapeHtml(labels[key] || key)}</div>
              ${item.title ? `<div class="platform-line"><strong>Title:</strong> ${escapeHtml(item.title)}</div>` : ''}
              ${item.caption ? `<div class="platform-line"><strong>Caption:</strong> ${escapeHtml(item.caption)}</div>` : ''}
              ${tags ? `<div class="publish-tags">${tags}</div>` : ''}
              ${item.best_time ? `<div class="platform-line"><strong>Time:</strong> ${escapeHtml(item.best_time)}</div>` : ''}
              ${item.format ? `<div class="platform-line"><strong>Format:</strong> ${escapeHtml(item.format)}</div>` : ''}
              ${item.posting_tip ? `<div class="platform-line"><strong>Tip:</strong> ${escapeHtml(item.posting_tip)}</div>` : ''}
            </div>
          `;
        }).join('')}
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
    showToast('Enter a base URL first', 'error');
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
    showToast(`${data.models.length} models loaded`, 'success');
  } catch (e) {
    showToast('Failed to load models', 'error');
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
        body: JSON.stringify({base_url: baseUrl, api_key: apiKey, task: mod.prefix === 'cm' ? 'caption_maker' : ''}),
      });
      const data = await resp.json();
      showToast(`${mod.name}: ${data.status === 'ok' ? 'Valid' : data.message}`, data.status === 'ok' ? 'success' : 'error');
    } catch (e) {
      showToast(`${mod.name}: Connection error`, 'error');
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
    showToast('AI settings saved!', 'success');
  } catch (e) {
    showToast('Failed to save', 'error');
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
    showToast('Performance settings saved!', 'success');
  } catch (e) {
    showToast('Failed to save', 'error');
  }
}

async function saveOutputSettings() {
  const data = {
    output_dir: document.getElementById('output-dir').value,
    system_prompt: document.getElementById('system-prompt').value,
    temperature: parseFloat(document.getElementById('temperature').value),
  };

  try {
    await fetch('/api/settings/output', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    showToast('Output settings saved!', 'success');
  } catch (e) {
    showToast('Failed to save', 'error');
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
    showToast('Watermark settings saved!', 'success');
  } catch (e) {
    showToast('Failed to save', 'error');
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
    showToast('Credit watermark settings saved!', 'success');
  } catch (e) {
    showToast('Failed to save', 'error');
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
      showToast('Watermark uploaded!', 'success');
    }
  } catch (e) {
    showToast('Upload failed', 'error');
  }
}


// ── Status Page ────────────────────────────────────
async function loadLibStatus() {
  const grid = document.getElementById('lib-grid');
  grid.innerHTML = '<div class="lib-item"><div class="lib-icon">⏳</div><div class="lib-name">Loading...</div></div>';

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
      const div = document.createElement('div');
      div.className = 'lib-item';
      div.innerHTML = `
        <div class="lib-icon">${info.available ? lib.icon : '❌'}</div>
        <div class="lib-name">${lib.name}</div>
        <div class="lib-version" style="color:${info.available ? 'var(--green)' : 'var(--red)'}">
          ${info.available ? (info.version || 'Available') : 'Not found'}
        </div>
      `;
      grid.appendChild(div);
    });

    // Update home lib status
    const homeStatus = document.getElementById('home-lib-status');
    const allOk = data.ffmpeg?.available && data.ytdlp?.available;
    homeStatus.innerHTML = allOk
      ? '<span style="color:var(--green)">Libraries: Ready</span>'
      : '<span style="color:var(--red)">Some libraries missing. <a href="#" onclick="showPage(\'status\'); return false;" style="color:var(--accent)">Check status</a></span>';

  } catch (e) {
    grid.innerHTML = '<div class="lib-item"><div class="lib-icon">⚠️</div><div class="lib-name">Error loading</div></div>';
  }
}


// ── About / Updates ────────────────────────────────
async function checkUpdate() {
  const el = document.getElementById('update-status');
  el.textContent = 'Checking...';

  try {
    const resp = await fetch('/api/version/check');
    const data = await resp.json();
    if (data.update_available) {
      el.innerHTML = `Update available: v${data.latest} <a href="${data.download_url}" target="_blank" class="btn btn-primary btn-sm" style="margin-left:8px">Download</a>`;
    } else {
      el.textContent = 'You are on the latest version!';
    }
  } catch (e) {
    el.textContent = 'Could not check for updates';
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


// ── Init ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkCookiesStatus();
  loadLibStatus();
});
