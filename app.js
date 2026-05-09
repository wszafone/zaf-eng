/*
 * 자프영어 — 나만의 영어 단어 & 생활영어 학습 앱
 * 기술스택: HTML5 / CSS3 / Vanilla JS / Firebase Realtime Database
 * 작성일: 2026-04-29
 */

/* ═══════════════════════════════════════════════════════════════
   Storage — Firebase Realtime Database
   단어·예문·설정·퀴즈결과 → Firebase
   Claude API 키 → IndexedDB (민감 데이터, 기기 로컬 보관)
═══════════════════════════════════════════════════════════════ */
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_SETTINGS = {
  voiceName: '', streak: 0, lastStudyDate: '',
  dailyGoal: 10, quizMode: 'multiple', defaultLevel: 'all'
};

// ── Firebase 초기화 ────────────────────────────────────────────
firebase.initializeApp({
  apiKey:            'AIzaSyCTVVCzP-Z5FkoGfWke0oWRB96uCXvXIag',
  authDomain:        'zaf-eng.firebaseapp.com',
  databaseURL:       'https://zaf-eng-default-rtdb.firebaseio.com',
  projectId:         'zaf-eng',
  storageBucket:     'zaf-eng.firebasestorage.app',
  messagingSenderId: '792475365205',
  appId:             '1:792475365205:web:8046c7e18d1673a28d89dc'
});
const _rtdb = firebase.database();

// ── 메모리 캐시 (동기 읽기용) ──────────────────────────────────
let _words     = [];
let _sentences = [];
let _settings  = { ...DEFAULT_SETTINGS };
let _apiKey    = '';

// ── IndexedDB (Claude API 키 로컬 보관) ───────────────────────
let _idb = null;

function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('zaf_local', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('kv', { keyPath: 'k' });
    req.onsuccess = e => { _idb = e.target.result; resolve(); };
    req.onerror   = e => reject(e.target.error);
  });
}
function _idbGet(key) {
  return new Promise((resolve, reject) => {
    const req = _idb.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}
function _idbPut(item) {
  return new Promise((resolve, reject) => {
    const req = _idb.transaction('kv', 'readwrite').objectStore('kv').put(item);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

// ── Firebase 전체 로드 ─────────────────────────────────────────
async function _loadAll() {
  try {
    const snap = await _rtdb.ref('/').once('value');
    const data = snap.val() ?? {};
    _words     = data.words     ? Object.values(data.words)     : [];
    _sentences = data.sentences ? Object.values(data.sentences) : [];
    _settings  = data.settings  ? { ...DEFAULT_SETTINGS, ...data.settings } : { ...DEFAULT_SETTINGS };
  } catch(e) {
    console.error('Firebase 로드 실패:', e);
  }
  try {
    const row = await _idbGet('apiKey');
    _apiKey = row?.v ?? '';
  } catch(e) { _apiKey = ''; }
}

// ── 배열 → Firebase 객체 변환 ─────────────────────────────────
function _toObj(arr) {
  if (!arr.length) return null;
  const o = {};
  arr.forEach(item => { o[item.id] = item; });
  return o;
}

// ── 동기 접근자 (메모리 읽기) ──────────────────────────────────
function getWords()     { return [..._words]; }
function getSentences() { return [..._sentences]; }
function getSettings()  { return { ..._settings }; }
function getApiKey()    { return _apiKey; }

// ── 저장 (메모리 즉시 반영 + Firebase 비동기 영속) ──────────────
function saveWords(a)    { _words     = a; _rtdb.ref('/words').set(_toObj(a)).catch(console.error); }
function saveSentences(a){ _sentences = a; _rtdb.ref('/sentences').set(_toObj(a)).catch(console.error); }
function saveSettings(o) { _settings  = o; _rtdb.ref('/settings').set(o).catch(console.error); }
function saveApiKey(k)   { _apiKey    = k; _idbPut({ k: 'apiKey', v: k }).catch(console.error); }

// ── 단어 통계 부분 업데이트 (퀴즈 중 매 문제마다 호출, 최적화) ──
function _patchWordStat(wordId) {
  const w = _words.find(w => w.id === wordId);
  if (w) _rtdb.ref(`/words/${wordId}`).set(w).catch(console.error);
}

// ── 퀴즈 결과 저장 ─────────────────────────────────────────────
function saveQuizResult(payload) {
  const id = crypto.randomUUID();
  _rtdb.ref(`/quizResults/${id}`).set({ id, ...payload }).catch(console.error);
}

// ── 삭제 헬퍼 ─────────────────────────────────────────────────
function clearWords()     { _words     = []; return _rtdb.ref('/words').remove(); }
function clearSentences() { _sentences = []; return _rtdb.ref('/sentences').remove(); }
function clearAll()       {
  _words = []; _sentences = []; _settings = { ...DEFAULT_SETTINGS }; _apiKey = '';
  _idbPut({ k: 'apiKey', v: '' }).catch(console.error);
  return _rtdb.ref('/').remove();
}


/* ═══════════════════════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════════════════════ */
/* ─── Toast ─── */
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

/* TTS — 음성 품질 점수 (높을수록 자연스러움) */
function _voiceQuality(v) {
  const n = v.name.toLowerCase();
  // Neural / Natural (Edge neural, Google neural)
  if (/neural|natural|wavenet/.test(n))                           return 4;
  // Enhanced / Premium (iOS Enhanced, macOS Enhanced)
  if (/enhanced|premium/.test(n))                                 return 3;
  // Online voices (Google online, MS online non-neural)
  if (!v.localService)                                            return 2;
  // Known good local voices (macOS Samantha, Alex, Karen, Daniel...)
  if (/samantha|alex|karen|daniel|moira|fiona|victoria/.test(n)) return 1;
  return 0;
}

function _bestEnglishVoice() {
  const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
  return voices.sort((a, b) => _voiceQuality(b) - _voiceQuality(a))[0] ?? null;
}

/* TTS 재생 */
function speakText(text, voiceName) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  let voice = voiceName ? voices.find(v => v.name === voiceName) : null;
  if (!voice) voice = _bestEnglishVoice();
  if (voice) utt.voice = voice;
  utt.rate  = 0.88; // 약간 느리게 — 발음이 명확하고 자연스러워짐
  utt.pitch = 1.0;
  utt.volume = 1.0;
  speechSynthesis.speak(utt);
}

function speakById(type, id) {
  let text = '';
  if (type === 'word') {
    text = getWords().find(w => w.id === id)?.word ?? '';
  } else {
    text = getSentences().find(s => s.id === id)?.en ?? '';
  }
  if (text) speakText(text, getSettings().voiceName);
}

function speakQuizPrompt() {
  if (!qzSession) return;
  const { quizType, mode, words, items, current } = qzSession;
  let text = '';
  if (quizType === 'word') text = words[current].word;
  else text = mode === 'sentence-en-ko' ? items[current].en : items[current].ko;
  if (text) speakText(text, getSettings().voiceName);
}

/* CSV 한 줄 파싱 — 따옴표 필드 지원 */
function parseCSVLine(line) {
  const res = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  res.push(cur.trim());
  return res;
}

/* CSV Blob 다운로드 (BOM 포함, Excel 호환) */
function downloadCsv(rows, filename) {
  const csv  = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const POS_LABEL   = { noun:'명사', verb:'동사', adj:'형용사', adv:'부사', etc:'기타' };
const LEVEL_LABEL = { middle:'중고등', high:'중고등' };

function sentCountOf(wordId, sentences) {
  return sentences.filter(s => s.wordId === wordId).length;
}

/* ═══════════════════════════════════════════════════════════════
   Modal helpers
═══════════════════════════════════════════════════════════════ */
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close on backdrop click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// Close on [data-close] buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('word-modal').classList.contains('open'))        closeModal('word-modal');
  if (document.getElementById('sent-modal').classList.contains('open'))        closeModal('sent-modal');
  if (document.getElementById('study-edit-modal').classList.contains('open')) closeModal('study-edit-modal');
});

/* ═══════════════════════════════════════════════════════════════
   Hash Router
═══════════════════════════════════════════════════════════════ */
const VALID_VIEWS = ['home','quiz-word','quiz-sentence','manage-words','settings'];

function getActiveView() {
  const h = location.hash.replace('#','');
  return VALID_VIEWS.includes(h) ? h : 'home';
}

function navigate() {
  const target = getActiveView();
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === target));
  document.querySelectorAll('.nav-tab').forEach(el => {
    const on = el.dataset.view === target;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', String(on));
  });
  if (!VALID_VIEWS.includes(location.hash.replace('#',''))) history.replaceState(null,'','#home');
  if (target === 'home')             renderHome();
  if (target === 'quiz-word')        renderQuizSetup('qw-root', 'word');
  if (target === 'quiz-sentence')    renderQuizSetup('qs-root', 'sentence');
  if (target === 'manage-words') renderManage();
  if (target === 'settings')     renderSettings();
}

// 퀴즈 진행 중 탭 이동 방지
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', e => {
    if (!qzSession) return;
    const quizView = qzSession.rootId === 'qw-root' ? 'quiz-word' : 'quiz-sentence';
    if (tab.dataset.view === quizView) return;
    if (!confirm('퀴즈가 진행 중입니다. 종료하시겠습니까?')) {
      e.preventDefault();
    } else {
      qzSession = null;
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   ── WORD MANAGEMENT ──
═══════════════════════════════════════════════════════════════ */
const mwState = { search: '', level: 'all', sortBy: 'date' };
let _manageSubTab = 'words';
const _selWords   = new Set();
const _selSents   = new Set();

// ── 서브탭 렌더 진입점 ──────────────────────────────────────────
function renderManage() {
  if (_manageSubTab === 'words') renderWordTable();
  else renderSentenceTable();
}

function switchManageTab(tab) {
  _manageSubTab = tab;
  _selWords.clear();
  _selSents.clear();

  document.querySelectorAll('#manage-words .sub-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.subtab === tab)
  );

  const isWords = tab === 'words';
  document.getElementById('mw-filter-group')?.classList.toggle('hidden', !isWords);
  document.getElementById('mw-sort-btn')?.classList.toggle('hidden', !isWords);
  document.getElementById('mw-add-btn').textContent = isWords ? '+ 새 단어 추가' : '+ 새 예문 추가';
  document.getElementById('mw-word-table').style.display = isWords ? '' : 'none';
  document.getElementById('ms-sent-table').style.display = isWords ? 'none' : '';

  updateBulkDeleteBtn();
  if (isWords) renderWordTable();
  else renderSentenceTable();
}

function updateBulkDeleteBtn() {
  const btn   = document.getElementById('mw-bulk-delete');
  if (!btn) return;
  const count = _manageSubTab === 'words' ? _selWords.size : _selSents.size;
  btn.style.display = count > 0 ? '' : 'none';
  if (count > 0) btn.textContent = `선택 삭제 (${count})`;
}

// ── 예문 테이블 ───────────────────────────────────────────────
function renderSentenceTable() {
  const wordMap = new Map(getWords().map(w => [w.id, w]));
  const q       = mwState.search.trim().toLowerCase();
  let sents = getSentences();

  if (q) {
    sents = sents.filter(s => {
      const w = wordMap.get(s.wordId);
      return (w?.word ?? '').toLowerCase().includes(q)
          || s.en.toLowerCase().includes(q)
          || s.ko.includes(q);
    });
  }
  sents.sort((a, b) => (wordMap.get(a.wordId)?.word ?? '').localeCompare(wordMap.get(b.wordId)?.word ?? ''));

  document.getElementById('mw-count').textContent = `총 ${sents.length}개`;
  const tbody = document.getElementById('ms-tbody');

  if (!sents.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">${
      getSentences().length === 0 ? '등록된 예문이 없습니다.' : '검색 결과가 없습니다.'
    }</div></td></tr>`;
    updateBulkDeleteBtn();
    return;
  }

  tbody.innerHTML = sents.map((s, i) => {
    const word = wordMap.get(s.wordId);
    return `
      <tr class="${_selSents.has(s.id) ? 'row-selected' : ''}">
        <td class="col-chk">
          <input type="checkbox" class="ms-row-chk" data-id="${escapeHtml(s.id)}" ${_selSents.has(s.id) ? 'checked' : ''} />
        </td>
        <td class="col-num">${i + 1}</td>
        <td class="col-word"><strong>${escapeHtml(word?.word ?? '(삭제됨)')}</strong></td>
        <td class="sent-en-cell">
          <div class="cell-with-tts">
            ${escapeHtml(s.en)}
            <button class="tts-btn tts-inline" onclick="speakById('sent','${escapeHtml(s.id)}')" aria-label="발음 듣기" title="발음 듣기">🔊</button>
          </div>
        </td>
        <td class="sent-ko-cell">${escapeHtml(s.ko)}</td>
        <td class="sent-source-cell">${s.source ? escapeHtml(s.source) : ''}</td>
        <td>
          <div class="col-actions">
            <button class="btn btn-ghost btn-sm" onclick="openSentenceModal('${escapeHtml(s.id)}','${escapeHtml(s.wordId)}')">수정</button>
            <button class="btn btn-danger btn-sm" onclick="confirmDeleteSentRow('${escapeHtml(s.id)}','${escapeHtml(s.wordId)}')">삭제</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.querySelectorAll('#ms-tbody .ms-row-chk').forEach(chk => {
    chk.addEventListener('change', function() {
      const id = this.dataset.id;
      if (this.checked) _selSents.add(id);
      else _selSents.delete(id);
      this.closest('tr')?.classList.toggle('row-selected', this.checked);
      updateBulkDeleteBtn();
      _syncChkAll('ms-chk-all', document.querySelectorAll('#ms-tbody .ms-row-chk'));
    });
  });

  updateBulkDeleteBtn();
  _syncChkAll('ms-chk-all', document.querySelectorAll('#ms-tbody .ms-row-chk'));
}

function confirmDeleteSentRow(sentId, wordId) {
  if (!confirm('이 예문을 삭제할까요?')) return;
  saveSentences(getSentences().filter(s => s.id !== sentId));
  _selSents.delete(sentId);
  renderSentRow(wordId);
  updateSentBadge(wordId);
  renderSentenceTable();
}

function _syncChkAll(chkId, rowChks) {
  const el = document.getElementById(chkId);
  if (!el) return;
  const total = rowChks.length;
  const checked = [...rowChks].filter(c => c.checked).length;
  el.checked = total > 0 && checked === total;
  el.indeterminate = checked > 0 && checked < total;
}

function getFilteredWords() {
  const sents = getSentences();
  const q = mwState.search.trim().toLowerCase();
  let list = getWords().filter(w => {
    const okLevel  = mwState.level === 'all' || w.difficulty === mwState.level;
    const okSearch = !q || w.word.toLowerCase().includes(q) || (w.meaning ?? '').includes(q);
    return okLevel && okSearch;
  });
  if (mwState.sortBy === 'alpha') {
    list.sort((a,b) => a.word.localeCompare(b.word));
  } else {
    list.sort((a,b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
  return list.map(w => ({
    ...w,
    _sc:   sentCountOf(w.id, sents),
    _wsrc: w.source || (sents.find(s => s.wordId === w.id && s.source)?.source ?? ''),
  }));
}

function renderWordTable() {
  const list = getFilteredWords();
  document.getElementById('mw-count').textContent = `총 ${list.length}개`;
  const tbody = document.getElementById('mw-tbody');

  if (!list.length) {
    const noWords = getWords().length === 0;
    tbody.innerHTML = noWords
      ? `<tr><td colspan="7"><div class="empty-state">
           <div style="font-size:32px;margin-bottom:10px">📚</div>
           아직 단어가 없습니다. 첫 단어를 추가해보세요!<br>
           <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="openWordModal(null)">+ 첫 단어 추가</button>
         </div></td></tr>`
      : `<tr><td colspan="7"><div class="empty-state">검색 결과가 없습니다.</div></td></tr>`;
    updateBulkDeleteBtn();
    return;
  }

  tbody.innerHTML = list.map((w, i) => `
    <tr class="${_selWords.has(w.id) ? 'row-selected' : ''}">
      <td class="col-chk">
        <input type="checkbox" class="mw-row-chk" data-id="${escapeHtml(w.id)}" ${_selWords.has(w.id) ? 'checked' : ''} />
      </td>
      <td class="col-num">${i+1}</td>
      <td>
        <div class="cell-with-tts">
          <strong>${escapeHtml(w.word)}</strong>
          <button class="tts-btn" onclick="speakById('word','${escapeHtml(w.id)}')" aria-label="발음 듣기" title="발음 듣기">🔊</button>
        </div>
      </td>
      <td>${escapeHtml(w.meaning)}</td>
      <td class="sent-source-cell">${w._wsrc ? escapeHtml(w._wsrc) : ''}</td>
      <td>
        <button class="sent-toggle-btn" id="sent-badge-${escapeHtml(w.id)}"
          onclick="toggleSentRow('${escapeHtml(w.id)}')">예문 ${w._sc}</button>
      </td>
      <td>
        <div class="col-actions">
          <button class="btn btn-ghost btn-sm" onclick="openWordModal('${escapeHtml(w.id)}')">수정</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteWord('${escapeHtml(w.id)}')">삭제</button>
        </div>
      </td>
    </tr>
    <tr class="sent-subrow" id="sent-subrow-${escapeHtml(w.id)}" style="display:none">
      <td colspan="7" class="sent-subrow-cell">
        <div id="sent-subrow-content-${escapeHtml(w.id)}"></div>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('#mw-tbody .mw-row-chk').forEach(chk => {
    chk.addEventListener('change', function() {
      const id = this.dataset.id;
      if (this.checked) _selWords.add(id);
      else _selWords.delete(id);
      this.closest('tr')?.classList.toggle('row-selected', this.checked);
      updateBulkDeleteBtn();
      _syncChkAll('mw-chk-all', document.querySelectorAll('#mw-tbody .mw-row-chk'));
    });
  });

  updateBulkDeleteBtn();
  _syncChkAll('mw-chk-all', document.querySelectorAll('#mw-tbody .mw-row-chk'));
}

// ── Word Modal ──────────────────────────────────────────────
function openWordModal(id) {
  clearWmErrors();
  const isEdit = Boolean(id);
  document.getElementById('wm-title').textContent = isEdit ? '단어 수정' : '새 단어 추가';

  if (isEdit) {
    const w = getWords().find(w => w.id === id);
    if (!w) return;
    document.getElementById('wm-id').value      = w.id;
    document.getElementById('wm-word').value    = w.word;
    document.getElementById('wm-pos').value     = w.pos;
    document.getElementById('wm-meaning').value = w.meaning;
    document.getElementById('wm-source').value  = w.source ?? '';
  } else {
    document.getElementById('wm-id').value      = '';
    document.getElementById('wm-word').value    = '';
    document.getElementById('wm-pos').value     = 'verb';
    document.getElementById('wm-meaning').value = '';
    document.getElementById('wm-source').value  = '';
  }
  openModal('word-modal');
  document.getElementById('wm-word').focus();
}

function clearWmErrors() {
  ['wm-word','wm-meaning'].forEach(id => document.getElementById(id).classList.remove('is-err'));
  ['wm-word-err','wm-meaning-err'].forEach(id => { document.getElementById(id).textContent = ''; });
}

document.getElementById('wm-save').addEventListener('click', () => {
  clearWmErrors();
  const wordVal    = document.getElementById('wm-word').value.trim();
  const meaningVal = document.getElementById('wm-meaning').value.trim();
  let ok = true;

  if (!wordVal) {
    document.getElementById('wm-word').classList.add('is-err');
    document.getElementById('wm-word-err').textContent = '영어단어를 입력해주세요.';
    ok = false;
  }
  if (!meaningVal) {
    document.getElementById('wm-meaning').classList.add('is-err');
    document.getElementById('wm-meaning-err').textContent = '한국어뜻을 입력해주세요.';
    ok = false;
  }
  if (!ok) return;

  const id     = document.getElementById('wm-id').value;
  const pos    = document.getElementById('wm-pos').value;
  const source = document.getElementById('wm-source').value.trim();
  const words  = getWords();

  if (id) {
    const idx = words.findIndex(w => w.id === id);
    if (idx >= 0) {
      words[idx] = { ...words[idx], word: wordVal, pos, meaning: meaningVal };
      if (source) words[idx].source = source; else delete words[idx].source;
    }
  } else {
    const newWord = { id: crypto.randomUUID(), word: wordVal, pos, meaning: meaningVal, difficulty: 'high', createdAt: Date.now() };
    if (source) newWord.source = source;
    words.push(newWord);
  }

  saveWords(words);
  closeModal('word-modal');
  renderWordTable();
  showToast(id ? '단어가 수정되었습니다.' : '단어가 추가되었습니다.');
});

// ── Delete Word ─────────────────────────────────────────────
function confirmDeleteWord(id) {
  const sents = getSentences().filter(s => s.wordId === id);
  const msg = sents.length
    ? `이 단어와 연결된 예문 ${sents.length}개도 함께 삭제됩니다. 계속하시겠습니까?`
    : '이 단어를 삭제할까요?';
  if (!confirm(msg)) return;
  saveWords(getWords().filter(w => w.id !== id));
  saveSentences(getSentences().filter(s => s.wordId !== id));
  _selWords.delete(id);
  renderWordTable();
}

// ── Toolbar events ──────────────────────────────────────────
document.getElementById('mw-add-btn').addEventListener('click', () => {
  if (_manageSubTab === 'words') openWordModal(null);
  else openSentenceModal(null, null);
});

document.getElementById('mw-search').addEventListener('input', function() {
  mwState.search = this.value;
  renderManage();
});

document.querySelector('#manage-words .sub-tab-bar').addEventListener('click', e => {
  const btn = e.target.closest('.sub-tab');
  if (btn) switchManageTab(btn.dataset.subtab);
});

document.getElementById('mw-chk-all').addEventListener('change', function() {
  document.querySelectorAll('#mw-tbody .mw-row-chk').forEach(chk => {
    chk.checked = this.checked;
    if (this.checked) _selWords.add(chk.dataset.id);
    else _selWords.delete(chk.dataset.id);
    chk.closest('tr')?.classList.toggle('row-selected', this.checked);
  });
  updateBulkDeleteBtn();
});

document.getElementById('ms-chk-all').addEventListener('change', function() {
  document.querySelectorAll('#ms-tbody .ms-row-chk').forEach(chk => {
    chk.checked = this.checked;
    if (this.checked) _selSents.add(chk.dataset.id);
    else _selSents.delete(chk.dataset.id);
    chk.closest('tr')?.classList.toggle('row-selected', this.checked);
  });
  updateBulkDeleteBtn();
});

document.getElementById('mw-bulk-delete').addEventListener('click', () => {
  if (_manageSubTab === 'words') {
    const count = _selWords.size;
    if (!count) return;
    const linked = getSentences().filter(s => _selWords.has(s.wordId)).length;
    const msg = linked
      ? `단어 ${count}개와 연결된 예문 ${linked}개를 모두 삭제합니다. 계속하시겠습니까?`
      : `선택한 단어 ${count}개를 삭제합니다. 계속하시겠습니까?`;
    if (!confirm(msg)) return;
    saveWords(getWords().filter(w => !_selWords.has(w.id)));
    saveSentences(getSentences().filter(s => !_selWords.has(s.wordId)));
    _selWords.clear();
    renderWordTable();
    showToast(`단어 ${count}개가 삭제되었습니다.`);
  } else {
    const count = _selSents.size;
    if (!count) return;
    if (!confirm(`선택한 예문 ${count}개를 삭제합니다. 계속하시겠습니까?`)) return;
    saveSentences(getSentences().filter(s => !_selSents.has(s.id)));
    _selSents.clear();
    renderSentenceTable();
    showToast(`예문 ${count}개가 삭제되었습니다.`);
  }
});

document.querySelectorAll('#manage-words .filter-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('#manage-words .filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    mwState.level = this.dataset.level;
    renderWordTable();
  });
});

const sortBtn = document.getElementById('mw-sort-btn');
sortBtn.addEventListener('click', () => {
  mwState.sortBy = mwState.sortBy === 'date' ? 'alpha' : 'date';
  sortBtn.textContent = mwState.sortBy === 'date' ? '등록순 ↕' : '가나다순 ↕';
  renderWordTable();
});

// ── File Upload helper ────────────────────────────────────────
function readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const ext    = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = e => {
      try {
        if (ext === 'xlsx' || ext === 'xls') {
          const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          resolve(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }));
        } else {
          const bytes = new Uint8Array(e.target.result);
          const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
          const text  = new TextDecoder(hasUtf8Bom ? 'utf-8' : 'euc-kr').decode(e.target.result);
          resolve(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => parseCSVLine(l)));
        }
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── File Upload (Words) — CSV & Excel ───────────────────────
function importWordRows(rows) {
  if (rows.length < 2) { showToast('데이터가 없습니다.'); return 0; }

  const header = rows[0].map(h => String(h ?? '').toLowerCase().trim());
  const wi = (() => {
    const i = header.findIndex(h => /^(word|영어|단어|english)/.test(h));
    return i >= 0 ? i : 0;
  })();
  const mi = (() => {
    const i = header.findIndex(h => /^(meaning|뜻|한국어|korean|의미)/.test(h));
    if (i >= 0) return i;
    return wi === 0 ? 1 : 0;
  })();
  const pi = header.findIndex(h => /^(pos|품사|part)/.test(h));

  const existing = getWords();
  const seen = new Set(existing.map(w => w.word.toLowerCase()));
  const now  = Date.now();
  let added  = 0;

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i];
    const word    = String(row[wi] ?? '').trim();
    const meaning = String(row[mi] ?? '').trim();
    const pos     = pi >= 0 ? String(row[pi] ?? '').trim() : '';
    if (!word || !meaning) continue;
    if (seen.has(word.toLowerCase())) continue;
    existing.push({ id: crypto.randomUUID(), word, pos: pos || 'etc', meaning, difficulty: 'high', createdAt: now + added });
    seen.add(word.toLowerCase());
    added++;
  }
  saveWords(existing);
  return added;
}

// ── Combined Upload (Words + Sentences) ─────────────────────
function importCombinedRows(rows) {
  if (rows.length < 2) { showToast('데이터가 없습니다.'); return { words: 0, sents: 0, skipped: 0 }; }

  const header = rows[0].map(h => String(h ?? '').toLowerCase().trim());
  const wIdx = (() => { const i = header.findIndex(h => /^(word|영어|단어|english)/.test(h)); return i >= 0 ? i : 1; })();
  const mIdx = (() => { const i = header.findIndex(h => /^(meaning|뜻|한국어|korean|의미|단어뜻)/.test(h)); return i >= 0 ? i : 2; })();
  const eIdx = (() => { const i = header.findIndex(h => /^(example|예문|sentence)/.test(h)); return i >= 0 ? i : 3; })();
  const kIdx = (() => { const i = header.findIndex(h => /^(예문뜻|translation|한글|ko)/.test(h)); return i >= 0 ? i : 4; })();
  const sIdx = (() => { const i = header.findIndex(h => /^(source|출처|소스)/.test(h)); return i >= 0 ? i : 5; })();

  const existingWords = getWords();
  const wordMap  = new Map(existingWords.map(w => [w.word.toLowerCase(), w]));
  const sents    = getSentences();
  const countMap = new Map();
  const sentKeys = new Set();
  sents.forEach(s => {
    countMap.set(s.wordId, (countMap.get(s.wordId) ?? 0) + 1);
    sentKeys.add(`${s.wordId}::${s.en.toLowerCase()}`);
  });

  const now = Date.now();
  let wordsAdded = 0, sentsAdded = 0, skipped = 0;
  let wordsDirty = false, sentsDirty = false;
  let lastWordObj = null; // 단어 없는 행의 예문을 이전 단어에 연결

  for (let i = 1; i < rows.length; i++) {
    const row     = rows[i];
    const word    = String(row[wIdx] ?? '').trim();
    const meaning = String(row[mIdx] ?? '').trim();
    const en      = String(row[eIdx] ?? '').trim();
    const ko      = String(row[kIdx] ?? '').trim();
    const source  = String(row[sIdx] ?? '').trim();

    const hasWord = !!(word && meaning);
    const hasSent = !!(en && ko);

    if (!hasWord && !hasSent) continue; // 완전히 빈 행

    // ── 단어 처리 ──
    if (hasWord) {
      if (!wordMap.has(word.toLowerCase())) {
        const newWord = { id: crypto.randomUUID(), word, pos: 'etc', meaning, difficulty: 'high', createdAt: now + wordsAdded };
        // 예문 없는 행의 출처는 단어에 저장
        if (!hasSent && source) newWord.source = source;
        existingWords.push(newWord);
        wordMap.set(word.toLowerCase(), newWord);
        wordsAdded++;
        wordsDirty = true;
      }
      lastWordObj = wordMap.get(word.toLowerCase());
    }

    // ── 예문 처리 ──
    if (hasSent) {
      // 단어 없는 행은 직전 단어에 연결
      const targetWord = lastWordObj;
      if (!targetWord) { skipped++; continue; }
      const key = `${targetWord.id}::${en.toLowerCase()}`;
      if (sentKeys.has(key)) { skipped++; continue; }
      if ((countMap.get(targetWord.id) ?? 0) >= 5) { skipped++; continue; }
      const sent = { id: crypto.randomUUID(), wordId: targetWord.id, en, ko };
      if (source) sent.source = source;
      sents.push(sent);
      sentKeys.add(key);
      countMap.set(targetWord.id, (countMap.get(targetWord.id) ?? 0) + 1);
      sentsAdded++;
      sentsDirty = true;
    }
  }

  if (wordsDirty) saveWords(existingWords);
  if (sentsDirty) saveSentences(sents);

  return { words: wordsAdded, sents: sentsAdded, skipped };
}

// ── Upload Button ─────────────────────────────────────────────
document.getElementById('mw-upload-help').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('mw-upload-popover').classList.toggle('open');
});

document.getElementById('mw-upload-btn').addEventListener('click', () => {
  document.getElementById('mw-upload-input').value = '';
  document.getElementById('mw-upload-input').click();
});

document.getElementById('mw-upload-input').addEventListener('change', async function() {
  const file = this.files[0];
  if (!file) return;
  const btn = document.getElementById('mw-upload-btn');
  btn.disabled = true; btn.textContent = '처리 중...';
  try {
    const rows   = await readFileAsRows(file);
    const result = importCombinedRows(rows);
    renderManage();
    const parts = [];
    if (result.words > 0) parts.push(`단어 ${result.words}개`);
    if (result.sents > 0) parts.push(`예문 ${result.sents}개`);
    const base = parts.length > 0 ? `${parts.join(', ')} 추가됨` : '추가된 항목이 없습니다.';
    showToast(result.skipped > 0 ? `${base} (${result.skipped}개 건너뜀)` : base);
  } catch(_) {
    showToast('파일을 읽을 수 없습니다. 형식을 확인해주세요.');
  }
  btn.disabled = false; btn.textContent = '파일 업로드';
});

/* ═══════════════════════════════════════════════════════════════
   ── SENTENCE MANAGEMENT (Inline Sub-rows) ──
═══════════════════════════════════════════════════════════════ */

// ── Toggle / Render Sub-row ──────────────────────────────────
function toggleSentRow(wordId) {
  const row = document.getElementById(`sent-subrow-${wordId}`);
  if (!row) return;
  if (row.style.display === 'none') {
    row.style.display = '';
    renderSentRow(wordId);
  } else {
    row.style.display = 'none';
  }
}

const _aiExamples = new Map();

function renderSentRow(wordId) {
  const content = document.getElementById(`sent-subrow-content-${wordId}`);
  if (!content) return;
  const word    = getWords().find(w => w.id === wordId);
  const sents   = getSentences().filter(s => s.wordId === wordId);
  const atLimit = sents.length >= 5;

  const listHtml = sents.length === 0
    ? '<div class="sent-subrow-empty">등록된 예문이 없습니다.</div>'
    : sents.map((s, i) => `
        <div class="sent-subrow-item">
          <span class="sent-subrow-num">${i+1}</span>
          <div class="sent-subrow-text">
            <div class="sent-subrow-en">
              ${escapeHtml(s.en)}
              <button class="tts-btn tts-inline" onclick="speakById('sent','${escapeHtml(s.id)}')" aria-label="발음 듣기" title="발음 듣기">🔊</button>
            </div>
            <div class="sent-subrow-ko">${escapeHtml(s.ko)}</div>
            ${s.source ? `<div class="sent-subrow-source">출처: ${escapeHtml(s.source)}</div>` : ''}
          </div>
          <div class="sent-subrow-btns">
            <button class="btn btn-ghost btn-sm" onclick="openSentenceModal('${escapeHtml(s.id)}','${escapeHtml(wordId)}')">수정</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSentenceInRow('${escapeHtml(s.id)}','${escapeHtml(wordId)}')">삭제</button>
          </div>
        </div>`).join('');

  content.innerHTML = `
    <div class="sent-subrow-inner">
      ${(() => { const src = word?.source || sents.find(s => s.source)?.source || ''; return src ? `<div class="sent-subrow-source">출처: ${escapeHtml(src)}</div>` : ''; })()}
      ${listHtml}
      <div class="sent-subrow-footer">
        <span class="sent-subrow-count">예문 ${sents.length} / 5</span>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" id="ai-row-btn-${escapeHtml(wordId)}"
            ${atLimit ? 'disabled' : ''}
            onclick="generateExamplesInRow('${escapeHtml(wordId)}')">AI 예문 생성</button>
          <button class="btn btn-primary btn-sm"
            ${atLimit ? 'disabled' : ''}
            onclick="openSentenceModal(null,'${escapeHtml(wordId)}')">+ 새 예문 추가</button>
        </div>
      </div>
      <div id="ai-panel-${escapeHtml(wordId)}"></div>
    </div>`;
}

function updateSentBadge(wordId) {
  const el  = document.getElementById(`sent-badge-${wordId}`);
  if (el) el.textContent = `예문 ${getSentences().filter(s => s.wordId === wordId).length}`;
}

function deleteSentenceInRow(sentId, wordId) {
  saveSentences(getSentences().filter(s => s.id !== sentId));
  _selSents.delete(sentId);
  renderSentRow(wordId);
  updateSentBadge(wordId);
}

// ── Sentence Modal ──────────────────────────────────────────
function openSentenceModal(id, wordId) {
  clearSmErrors();
  document.getElementById('sm-title').textContent = id ? '예문 수정' : '예문 추가';

  const wordField  = document.getElementById('sm-word-field');
  const wordSelect = document.getElementById('sm-word-select');

  if (id) {
    const s = getSentences().find(s => s.id === id);
    if (!s) return;
    document.getElementById('sm-id').value       = s.id;
    document.getElementById('sm-wordid').value   = s.wordId;
    document.getElementById('sm-en').value       = s.en;
    document.getElementById('sm-ko').value       = s.ko;
    document.getElementById('sm-source').value   = s.source ?? '';
    wordField.style.display = 'none';
  } else if (wordId) {
    document.getElementById('sm-id').value       = '';
    document.getElementById('sm-wordid').value   = wordId;
    document.getElementById('sm-en').value       = '';
    document.getElementById('sm-ko').value       = '';
    document.getElementById('sm-source').value   = '';
    wordField.style.display = 'none';
  } else {
    // 예문 탭에서 추가 — 단어 선택 드롭다운 표시
    document.getElementById('sm-id').value       = '';
    document.getElementById('sm-wordid').value   = '';
    document.getElementById('sm-en').value       = '';
    document.getElementById('sm-ko').value       = '';
    document.getElementById('sm-source').value   = '';
    wordField.style.display = '';
    const words = getWords().sort((a, b) => a.word.localeCompare(b.word));
    wordSelect.innerHTML = words.length
      ? '<option value="">— 단어 선택 —</option>' +
        words.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.word)} (${escapeHtml(w.meaning)})</option>`).join('')
      : '<option value="">등록된 단어가 없습니다</option>';
  }

  openModal('sent-modal');
  document.getElementById('sm-en').focus();
}

function clearSmErrors() {
  ['sm-en','sm-ko'].forEach(id => document.getElementById(id).classList.remove('is-err'));
  ['sm-en-err','sm-ko-err','sm-word-err'].forEach(id => { document.getElementById(id).textContent = ''; });
}

document.getElementById('sm-save').addEventListener('click', () => {
  clearSmErrors();
  const en     = document.getElementById('sm-en').value.trim();
  const ko     = document.getElementById('sm-ko').value.trim();
  const source = document.getElementById('sm-source').value.trim();
  let ok = true;
  if (!en) { document.getElementById('sm-en').classList.add('is-err'); document.getElementById('sm-en-err').textContent = '영어예문을 입력해주세요.'; ok = false; }
  if (!ko) { document.getElementById('sm-ko').classList.add('is-err'); document.getElementById('sm-ko-err').textContent = '한국어해석을 입력해주세요.'; ok = false; }
  if (!ok) return;

  const id    = document.getElementById('sm-id').value;
  const wf    = document.getElementById('sm-word-field');
  const fromSentTable = wf && wf.style.display !== 'none';
  let wordId  = document.getElementById('sm-wordid').value;

  if (fromSentTable) {
    wordId = document.getElementById('sm-word-select').value;
    if (!wordId) { document.getElementById('sm-word-err').textContent = '단어를 선택해주세요.'; return; }
  }

  const sents = getSentences();

  if (id) {
    const idx = sents.findIndex(s => s.id === id);
    if (idx >= 0) {
      sents[idx] = { ...sents[idx], en, ko };
      if (source) sents[idx].source = source; else delete sents[idx].source;
    }
  } else {
    if (!wordId) return;
    if (sents.filter(s => s.wordId === wordId).length >= 5) { showToast('최대 5개까지 등록 가능합니다.'); return; }
    const sent = { id: crypto.randomUUID(), wordId, en, ko };
    if (source) sent.source = source;
    sents.push(sent);
  }

  saveSentences(sents);
  closeModal('sent-modal');
  renderSentRow(wordId);
  updateSentBadge(wordId);
  if (fromSentTable || _manageSubTab === 'sentences') renderSentenceTable();
  showToast('예문이 저장되었습니다.');
});

// ── AI 예문 생성 (Inline) ─────────────────────────────────────
async function generateExamplesInRow(wordId) {
  const word  = getWords().find(w => w.id === wordId);
  if (!word) return;
  const btn   = document.getElementById(`ai-row-btn-${wordId}`);
  const panel = document.getElementById(`ai-panel-${wordId}`);
  if (!btn || !panel) return;

  btn.disabled = true; btn.textContent = '생성 중...';
  panel.innerHTML = '';

  const examples = await generateExamples(word.word, word.meaning, word.pos);
  btn.disabled = false; btn.textContent = 'AI 예문 생성';
  if (!examples?.length) return;

  _aiExamples.set(wordId, examples);

  panel.innerHTML = `
    <div class="ai-panel" style="margin-top:10px">
      <div class="ai-panel-title">AI 추천 예문 — 추가 버튼으로 저장하세요</div>
      ${examples.map((ex, i) => `
        <div class="ai-suggestion" id="ai-sug-${escapeHtml(wordId)}-${i}">
          <div class="ai-suggestion-text">
            <div class="ai-suggestion-en">${escapeHtml(ex.en)}</div>
            <div class="ai-suggestion-ko">${escapeHtml(ex.ko)}</div>
          </div>
          <button class="btn btn-primary btn-sm" data-widx="${escapeHtml(wordId)}" data-i="${i}">추가</button>
        </div>`).join('')}
    </div>`;

  panel.querySelectorAll('.ai-suggestion button').forEach(b => {
    b.addEventListener('click', function() {
      const wId = this.dataset.widx;
      const idx = parseInt(this.dataset.i, 10);
      const ex  = _aiExamples.get(wId)?.[idx];
      if (!ex) return;
      const cur = getSentences().filter(s => s.wordId === wId);
      if (cur.length >= 5) { showToast('최대 5개까지 등록 가능합니다.'); return; }
      const all = getSentences();
      all.push({ id: crypto.randomUUID(), wordId: wId, en: ex.en, ko: ex.ko });
      saveSentences(all);
      document.getElementById(`ai-sug-${wId}-${idx}`)?.classList.add('used');
      this.disabled = true; this.textContent = '추가됨';
      renderSentRow(wId);
      updateSentBadge(wId);
      showToast('예문이 추가되었습니다.');
    });
  });
}

document.addEventListener('click', () => {
  document.querySelectorAll('.help-popover.open').forEach(p => p.classList.remove('open'));
});

/* ═══════════════════════════════════════════════════════════════
   ── QUIZ ENGINE ──
═══════════════════════════════════════════════════════════════ */
let qzSession  = null;   // active quiz session
let _seContext = null;   // { wordId, sentId? } — 학습 중 수정 대상

// ── Weight Algorithm ──────────────────────────────────────────
function calcWeight(word) {
  const s = word.stats ?? { shown: 0, correct: 0 };
  if (s.shown === 0) return 1.5;              // 미출제 우대
  const rate = s.correct / s.shown;
  return 1 + (1 - rate);                     // 0%→2.0  100%→1.0
}

function weightedPick(pool, count) {
  const result    = [];
  const remaining = [...pool];
  while (result.length < count && remaining.length > 0) {
    const weights = remaining.map(calcWeight);
    const total   = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let i = 0;
    for (; i < weights.length - 1; i++) { r -= weights[i]; if (r <= 0) break; }
    result.push(remaining[i]);
    remaining.splice(i, 1);
  }
  return result;
}

function pickDailyWords(level, count) {
  const pool = getWords().filter(w => level === 'all' || w.difficulty === level);
  return pool.length <= count ? [...pool] : weightedPick(pool, count);
}

// 퀴즈 설정 화면 렌더링
function renderQuizSetup(rootId, quizType) {
  qzSession = null;
  const cfg    = getSettings();
  const isWord = quizType === 'word';
  const words  = getWords();

  // 단어 0개 빈 상태
  if (words.length === 0) {
    document.getElementById(rootId).innerHTML = `
      <div class="empty-state" style="padding:60px 20px">
        <div style="font-size:40px;margin-bottom:12px">📚</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:8px;color:var(--text)">단어가 없습니다</div>
        <div style="margin-bottom:20px">퀴즈를 시작하려면 단어를 먼저 추가하세요.</div>
        <a class="btn btn-primary" href="#manage-words" aria-label="단어 관리로 이동">단어 관리로 이동</a>
      </div>`;
    return;
  }

  const dirOptions = isWord
    ? [['en-ko','영어 → 한국어'], ['ko-en','한국어 → 영어']]
    : [['en-ko','영어예문 → 한국어해석'], ['ko-en','한국어해석 → 영어예문']];

  const hasSents  = getSentences().length > 0;
  const blocked   = !isWord && !hasSents;
  const defMode   = cfg.quizMode ?? 'multiple';
  const defCount  = Math.min(20, Math.max(5, Math.round((cfg.dailyGoal ?? 10) / 5) * 5));

  document.getElementById(rootId).innerHTML = `
    <div class="qz-setup">
      <h2 class="qz-title">${isWord ? '단어 퀴즈' : '예문 퀴즈'}</h2>

      <div class="qz-section">
        <div class="qz-section-label">퀴즈 방향</div>
        <div class="qz-toggle-group" data-group="dir">
          ${dirOptions.map(([v,l], i) =>
            `<button class="qz-toggle-btn${i===0?' active':''}" data-val="${v}">${l}</button>`
          ).join('')}
        </div>
      </div>

      <div class="qz-section">
        <div class="qz-section-label">퀴즈 모드</div>
        <div class="qz-toggle-group" data-group="mode">
          <button class="qz-toggle-btn${defMode !== 'subjective' ? ' active' : ''}" data-val="multiple">객관식 (4지선다)</button>
          <button class="qz-toggle-btn${defMode === 'subjective' ? ' active' : ''}" data-val="subjective">주관식 (직접 입력)</button>
        </div>
      </div>

      <div class="qz-section">
        <div class="qz-section-label">문제 수: <strong class="qz-cnt">${defCount}</strong>문제</div>
        <input type="range" class="qz-range" min="5" max="20" step="5" value="${defCount}" aria-label="문제 수 선택" />
      </div>

      ${blocked ? '<p class="qz-warn">예문을 먼저 등록해주세요.</p>' : ''}
      <button class="btn btn-primary qz-start-btn"${blocked ? ' disabled' : ''} aria-label="퀴즈 시작">퀴즈 시작</button>
    </div>
  `;

  document.querySelectorAll(`#${rootId} .qz-toggle-group`).forEach(grp => {
    grp.addEventListener('click', e => {
      const btn = e.target.closest('.qz-toggle-btn');
      if (!btn) return;
      grp.querySelectorAll('.qz-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const range = document.querySelector(`#${rootId} .qz-range`);
  const cntEl = document.querySelector(`#${rootId} .qz-cnt`);
  range.addEventListener('input', () => { cntEl.textContent = range.value; });

  document.querySelector(`#${rootId} .qz-start-btn`).addEventListener('click', () => {
    const dir      = document.querySelector(`#${rootId} [data-group="dir"] .active`).dataset.val;
    const quizMode = document.querySelector(`#${rootId} [data-group="mode"] .active`).dataset.val;
    const count    = parseInt(range.value, 10);
    startQuiz(rootId, quizType, `${quizType}-${dir}`, 'all', count, quizMode);
  });
}

// 퀴즈 세션 시작
function startQuiz(rootId, quizType, mode, level, count, quizMode = 'multiple') {
  if (quizType === 'word') {
    const words = pickDailyWords(level, count);
    if (!words.length) { showToast('해당 레벨의 단어가 없습니다.'); return; }
    if (quizMode === 'multiple' && getWords().filter(w => level === 'all' || w.difficulty === level).length < 4) {
      showToast('객관식 퀴즈에는 최소 4개 이상의 단어가 필요합니다.'); return;
    }
    qzSession = { rootId, quizType, mode, level, count, quizMode, words, current: 0, results: [] };
  } else {
    const allSents = getSentences();
    const pool = getWords()
      .filter(w => level === 'all' || w.difficulty === level)
      .filter(w => allSents.some(s => s.wordId === w.id));
    if (!pool.length) { showToast('해당 레벨에 예문이 있는 단어가 없습니다.'); return; }
    const chosen = pool.length <= count ? [...pool] : weightedPick(pool, count);
    const items  = chosen.map(w => {
      const ws = allSents.filter(s => s.wordId === w.id);
      const s  = ws[Math.floor(Math.random() * ws.length)];
      return { wordId: w.id, sentId: s.id, word: w.word, meaning: w.meaning, en: s.en, ko: s.ko, source: s.source ?? '' };
    });
    qzSession = { rootId, quizType, mode, level, count, quizMode, items, current: 0, results: [] };
  }
  renderQuestion();
}

// 문제 화면 렌더링 (객관식 / 주관식 분기)
function renderQuestion() {
  const { rootId, quizType, mode, current, words, items, quizMode } = qzSession;
  const total = quizType === 'word' ? words.length : items.length;
  const pct   = Math.round((current / total) * 100);

  let prompt, promptLabel, correct, answerId, isLong = false, sourceText = '';
  if (quizType === 'word') {
    const w = words[current];
    answerId   = w.id;
    sourceText = w.source || (getSentences().find(s => s.wordId === w.id && s.source)?.source ?? '');
    if (mode === 'word-en-ko') { prompt = w.word;    promptLabel = '영어 단어';   correct = w.meaning; }
    else                       { prompt = w.meaning; promptLabel = '한국어 뜻';   correct = w.word;    }
  } else {
    const it = items[current];
    answerId   = it.wordId;
    isLong     = true;
    sourceText = it.source ?? '';
    if (mode === 'sentence-en-ko') { prompt = it.en; promptLabel = '영어 예문';   correct = it.ko; }
    else                           { prompt = it.ko; promptLabel = '한국어 해석'; correct = it.en; }
  }

  const promptCls = isLong ? 'qz-prompt-sent' : 'qz-prompt-word';
  const progressHtml = `
    <div class="qz-progress">
      <div class="qz-progress-row">
        <span class="qz-progress-text">${current + 1} / ${total}</span>
      </div>
      <div class="qz-prog-bar"><div class="qz-prog-fill" style="width:${pct}%"></div></div>
    </div>`;
  const cardHtml = `
    <div class="qz-card" id="qz-card">
      <div class="qz-card-top">
        <span class="qz-prompt-label">${escapeHtml(promptLabel)}</span>
        <div class="qz-card-actions">
          <button class="qz-speak-btn" onclick="speakQuizPrompt()" aria-label="발음 듣기" title="발음 듣기">🔊</button>
          <button class="qz-edit-btn" onclick="openStudyEdit()" aria-label="수정하기">✏ 수정</button>
        </div>
      </div>
      <div class="${promptCls}" id="qz-prompt-text">${escapeHtml(prompt)}</div>
      ${sourceText ? `<div class="qz-source">출처: ${escapeHtml(sourceText)}</div>` : ''}
    </div>`;

  if (quizMode === 'subjective') {
    // 주관식 모드
    document.getElementById(rootId).innerHTML = `
      <div class="qz-question">
        ${progressHtml}${cardHtml}
        <div class="qz-input-row">
          <input type="text" class="qz-input" id="qz-input"
            placeholder="정답을 입력하세요" autocomplete="off" aria-label="퀴즈 답 입력" />
          <button class="btn btn-primary qz-submit-btn" id="qz-submit" aria-label="답 제출">확인</button>
        </div>
        <div class="qz-correct-ans" id="qz-correct-ans"></div>
        <div class="qz-feedback" id="qz-feedback"></div>
      </div>`;

    const input  = document.getElementById('qz-input');
    const submit = document.getElementById('qz-submit');
    const doSubmit = () => {
      if (submit.disabled) return;
      handleSubjective(input.value, correct, answerId);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    submit.addEventListener('click', doSubmit);
    input.focus();
  } else {
    // 객관식 모드
    let distractors = [];
    if (quizType === 'word') {
      const others = getWords().filter(w => w.id !== answerId).sort(() => Math.random() - .5);
      distractors  = others.map(w => mode === 'word-en-ko' ? w.meaning : w.word).filter(d => d !== correct);
    } else {
      const others = getSentences().filter(s => s.wordId !== answerId).sort(() => Math.random() - .5);
      distractors  = others.map(s => mode === 'sentence-en-ko' ? s.ko : s.en).filter(d => d !== correct);
    }
    distractors = [...new Set(distractors)].slice(0, 3);

    const choices   = [...distractors, correct].sort(() => Math.random() - .5);
    const corrIdx   = choices.indexOf(correct);
    const choiceCls = isLong ? 'qz-choices stacked' : 'qz-choices';

    document.getElementById(rootId).innerHTML = `
      <div class="qz-question">
        ${progressHtml}${cardHtml}
        <div class="${choiceCls}" id="qz-choices">
          ${choices.map((c, i) => `
            <button class="qz-choice" data-idx="${i}" aria-label="선택지 ${i+1}: ${escapeHtml(c)}">
              <span class="qz-choice-num">${i + 1}</span>
              <span>${escapeHtml(c)}</span>
            </button>`).join('')}
        </div>
        <button class="qz-dontknow-btn" id="qz-dontknow">모름</button>
        <div class="qz-feedback" id="qz-feedback"></div>
      </div>`;

    document.querySelectorAll('#qz-choices .qz-choice').forEach((btn, i) => {
      btn.addEventListener('click', () => handleChoice(i, i === corrIdx, answerId, corrIdx));
    });
    document.getElementById('qz-dontknow').addEventListener('click', () => handleDontKnow(answerId, corrIdx));
  }
}

// 주관식 채점 처리
function handleSubjective(inputVal, correct, answerId) {
  const isCorrect = inputVal.trim().toLowerCase() === correct.trim().toLowerCase();
  const input  = document.getElementById('qz-input');
  const submit = document.getElementById('qz-submit');
  input.disabled  = true;
  submit.disabled = true;
  input.classList.add(isCorrect ? 'correct' : 'wrong');

  const fb = document.getElementById('qz-feedback');
  fb.textContent = isCorrect ? '정답!' : '오답';
  fb.className   = 'qz-feedback ' + (isCorrect ? 'correct' : 'wrong');

  if (!isCorrect) {
    document.getElementById('qz-correct-ans').textContent = `정답: ${correct}`;
  }

  updateWordStats(answerId, isCorrect);
  qzSession.results.push({ wordId: answerId, correct: isCorrect });

  setTimeout(() => {
    const card = document.getElementById('qz-card');
    if (card) card.classList.add('fading');
    setTimeout(() => {
      qzSession.current++;
      const total = qzSession.quizType === 'word' ? qzSession.words.length : qzSession.items.length;
      if (qzSession.current >= total) renderResult();
      else                            renderQuestion();
    }, 280);
  }, 1200);
}

// ── Handle Choice ─────────────────────────────────────────────
function handleChoice(clickedIdx, isCorrect, answerId, corrIdx) {
  // Lock all
  document.querySelectorAll('.qz-choice').forEach(b => {
    b.disabled = true;
    b.style.pointerEvents = 'none';
  });

  const btns = document.querySelectorAll('.qz-choice');
  btns[clickedIdx].classList.add(isCorrect ? 'correct' : 'wrong');
  if (!isCorrect) btns[corrIdx].classList.add('correct');

  const fb = document.getElementById('qz-feedback');
  fb.textContent = isCorrect ? '정답!' : '오답';
  fb.className   = 'qz-feedback ' + (isCorrect ? 'correct' : 'wrong');

  updateWordStats(answerId, isCorrect);

  // Record result
  qzSession.results.push({ wordId: answerId, correct: isCorrect });

  // Fade → next after 1.2 s
  setTimeout(() => {
    const card = document.getElementById('qz-card');
    if (card) card.classList.add('fading');
    setTimeout(() => {
      qzSession.current++;
      const total = qzSession.quizType === 'word' ? qzSession.words.length : qzSession.items.length;
      if (qzSession.current >= total) renderResult();
      else                            renderQuestion();
    }, 280);
  }, 1200);
}

// ── 모름 버튼 ────────────────────────────────────────────────
function handleDontKnow(answerId, corrIdx) {
  document.querySelectorAll('.qz-choice').forEach(b => {
    b.disabled = true;
    b.style.pointerEvents = 'none';
  });
  const dk = document.getElementById('qz-dontknow');
  if (dk) { dk.disabled = true; dk.classList.add('used'); }

  document.querySelectorAll('.qz-choice')[corrIdx]?.classList.add('correct');

  const fb = document.getElementById('qz-feedback');
  fb.textContent = '모름';
  fb.className   = 'qz-feedback wrong';

  updateWordStats(answerId, false);
  qzSession.results.push({ wordId: answerId, correct: false });

  setTimeout(() => {
    const card = document.getElementById('qz-card');
    if (card) card.classList.add('fading');
    setTimeout(() => {
      qzSession.current++;
      const total = qzSession.quizType === 'word' ? qzSession.words.length : qzSession.items.length;
      if (qzSession.current >= total) renderResult();
      else                            renderQuestion();
    }, 280);
  }, 1200);
}

// ── 학습 중 수정 ───────────────────────────────────────────────
function openStudyEdit() {
  if (!qzSession) return;
  const { quizType, words, items, current } = qzSession;
  const isSent = quizType === 'sentence';

  if (!isSent) {
    const w = words[current];
    _seContext = { wordId: w.id, sentId: null };
    document.getElementById('se-word').value    = w.word;
    document.getElementById('se-meaning').value = w.meaning;
  } else {
    const it = items[current];
    _seContext = { wordId: it.wordId, sentId: it.sentId ?? null };
    const w = _words.find(w => w.id === it.wordId);
    document.getElementById('se-word').value    = w?.word    ?? it.word;
    document.getElementById('se-meaning').value = w?.meaning ?? it.meaning;
    document.getElementById('se-en').value      = it.en;
    document.getElementById('se-ko').value      = it.ko;
  }

  document.getElementById('se-sent-block').style.display = isSent ? '' : 'none';
  openModal('study-edit-modal');
  document.getElementById('se-word').focus();
}

function _refreshQuizPrompt() {
  if (!qzSession) return;
  const { quizType, mode, current, words, items } = qzSession;
  let prompt;
  if (quizType === 'word') {
    const w = words[current];
    prompt = mode === 'word-en-ko' ? w.word : w.meaning;
  } else {
    const it = items[current];
    prompt = mode === 'sentence-en-ko' ? it.en : it.ko;
  }
  const el = document.getElementById('qz-prompt-text');
  if (el) el.textContent = prompt;
}

document.getElementById('se-save').addEventListener('click', () => {
  if (!_seContext) return;

  const wordVal    = document.getElementById('se-word').value.trim();
  const meaningVal = document.getElementById('se-meaning').value.trim();
  if (!wordVal)    { showToast('영어단어를 입력해주세요.'); return; }
  if (!meaningVal) { showToast('한국어뜻을 입력해주세요.'); return; }

  // 단어 저장
  const words = getWords();
  const wIdx  = words.findIndex(w => w.id === _seContext.wordId);
  if (wIdx >= 0) {
    words[wIdx] = { ...words[wIdx], word: wordVal, meaning: meaningVal };
    saveWords(words);
  }

  // 예문 저장
  const hasSent = document.getElementById('se-sent-block').style.display !== 'none';
  if (hasSent && _seContext.sentId) {
    const en = document.getElementById('se-en').value.trim();
    const ko = document.getElementById('se-ko').value.trim();
    if (!en || !ko) { showToast('영어예문과 한국어해석을 모두 입력해주세요.'); return; }
    const sents = getSentences();
    const sIdx  = sents.findIndex(s => s.id === _seContext.sentId);
    if (sIdx >= 0) {
      sents[sIdx] = { ...sents[sIdx], en, ko };
      saveSentences(sents);
    }
    // 퀴즈 세션 메모리 업데이트
    if (qzSession?.items) {
      const it = qzSession.items[qzSession.current];
      if (it?.wordId === _seContext.wordId) {
        qzSession.items[qzSession.current] = { ...it, word: wordVal, meaning: meaningVal, en, ko };
      }
    }
  } else if (qzSession?.words) {
    const w = qzSession.words[qzSession.current];
    if (w?.id === _seContext.wordId) {
      qzSession.words[qzSession.current] = { ...w, word: wordVal, meaning: meaningVal };
    }
  }

  closeModal('study-edit-modal');
  _refreshQuizPrompt();
  showToast('수정되었습니다.');
});

// ── Update Word Stats ──────────────────────────────────────────
function updateWordStats(wordId, correct) {
  const idx = _words.findIndex(w => w.id === wordId);
  if (idx < 0) return;
  const s = _words[idx].stats ?? { shown: 0, correct: 0 };
  s.shown++;
  if (correct) s.correct++;
  _words[idx] = { ..._words[idx], stats: s };
  _patchWordStat(wordId);
}

// ── Render Result ──────────────────────────────────────────────
function renderResult() {
  updateStreak();

  const { rootId, quizType, mode, level, count, quizMode, results } = qzSession;
  const total      = results.length;
  const correctCnt = results.filter(r => r.correct).length;
  const pct        = total ? Math.round(correctCnt / total * 100) : 0;

  saveQuizResult({
    date:         new Date().toISOString(),
    quizType, mode, quizMode,
    total, correct: correctCnt, pct,
    wrongWordIds: [...new Set(results.filter(r => !r.correct).map(r => r.wordId))]
  });

  const wrongIds  = [...new Set(results.filter(r => !r.correct).map(r => r.wordId))];
  const allWords  = getWords();
  const wrongHtml = wrongIds.map(id => {
    const w = allWords.find(w => w.id === id);
    if (!w) return '';
    return `<div class="qz-wrong-card">
      <span class="qz-wrong-word">${escapeHtml(w.word)}</span>
      <button class="tts-btn tts-inline" onclick="speakById('word','${escapeHtml(w.id)}')" aria-label="발음 듣기" title="발음 듣기">🔊</button>
      <span class="qz-wrong-sep">→</span>
      <span class="qz-wrong-meaning">${escapeHtml(w.meaning)}</span>
    </div>`;
  }).join('');

  document.getElementById(rootId).innerHTML = `
    <div class="qz-result">
      <div class="qz-score-card">
        <div class="qz-score-num">${correctCnt}<span class="qz-score-total"> / ${total}</span></div>
        <div class="qz-score-pct">정답률 ${pct}%</div>
      </div>

      ${wrongIds.length
        ? `<div class="qz-wrong-section">
             <div class="qz-wrong-title">틀린 단어 (${wrongIds.length}개)</div>
             <div class="qz-wrong-list">${wrongHtml}</div>
           </div>`
        : '<p class="qz-perfect">모두 정답! 완벽합니다 🎉</p>'
      }

      <div class="qz-result-actions">
        <button class="btn btn-ghost" onclick="location.hash='#home'">홈으로</button>
        <button class="btn btn-primary" id="qz-retry">다시 풀기</button>
      </div>
    </div>
  `;

  document.getElementById('qz-retry').addEventListener('click', () => {
    startQuiz(rootId, quizType, mode, level, count);
  });
}

// ── Streak ────────────────────────────────────────────────────
function updateStreak() {
  const cfg  = getSettings();
  const today = new Date().toISOString().slice(0, 10);
  if (cfg.lastStudyDate === today) return;
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  cfg.streak        = cfg.lastStudyDate === yesterday ? (cfg.streak || 0) + 1 : 1;
  cfg.lastStudyDate = today;
  saveSettings(cfg);
}

// ── Keyboard: 1~4 select choice ───────────────────────────────
document.addEventListener('keydown', e => {
  if (!qzSession) return;
  const choices = document.querySelectorAll('.qz-choice:not([disabled])');
  if (!choices.length) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4 && choices[n - 1]) { e.preventDefault(); choices[n - 1].click(); }
  if (e.key === '0' || e.key.toLowerCase() === 'm') {
    const dk = document.getElementById('qz-dontknow');
    if (dk && !dk.disabled) { e.preventDefault(); dk.click(); }
  }
});

/* ═══════════════════════════════════════════════════════════════
   ── HOME DASHBOARD ──
═══════════════════════════════════════════════════════════════ */
function renderHome() {
  const words = getWords();
  const sents = getSentences();
  const cfg   = getSettings();

  const total     = words.length;
  const streak    = cfg.streak || 0;
  const sentTotal = sents.length;


  const mastered   = words.filter(w => w.stats && w.stats.shown >= 3 && w.stats.correct / w.stats.shown >= 0.8);
  const struggling = words.filter(w => w.stats && w.stats.shown >= 2 && w.stats.correct / w.stats.shown < 0.5);

  const suggested = pickDailyWords('all', 5);

  const masteredHtml = mastered.length
    ? mastered.slice(0, 12).map(w => `<span class="chip mastered">${escapeHtml(w.word)}</span>`).join('')
    : '<span style="font-size:12px;color:var(--text-muted)">퀴즈를 풀면 집계됩니다.</span>';

  const strugglingHtml = struggling.length
    ? struggling.slice(0, 12).map(w => `<span class="chip struggling">${escapeHtml(w.word)}</span>`).join('')
    : '<span style="font-size:12px;color:var(--text-muted)">틀린 단어가 없습니다.</span>';

  const suggestedHtml = suggested.length
    ? suggested.map(w => {
        const acc = w.stats && w.stats.shown > 0
          ? Math.round(w.stats.correct / w.stats.shown * 100) : null;
        const badge = acc !== null
          ? `<span class="badge ${acc >= 80 ? 'badge-acc-good' : 'badge-acc-warn'}">${acc}%</span>`
          : `<span class="badge badge-count">NEW</span>`;
        return `<div class="today-card">
          <div class="today-card-main">
            <div class="today-card-en">
              ${escapeHtml(w.word)}
              <button class="tts-btn tts-inline" onclick="speakById('word','${escapeHtml(w.id)}')" aria-label="발음 듣기" title="발음 듣기">🔊</button>
            </div>
            <div class="today-card-sub">${escapeHtml(w.meaning)} · ${escapeHtml(POS_LABEL[w.pos] ?? w.pos)}</div>
          </div>
          ${badge}
        </div>`;
      }).join('')
    : '<div class="empty-state">단어를 먼저 추가해주세요.</div>';

  document.getElementById('home-root').innerHTML = `
    <div class="dash-summary">
      <div class="dash-card">
        <div class="dash-card-icon">📚</div>
        <div class="dash-card-num">${total}</div>
        <div class="dash-card-label">총 단어</div>
      </div>
      <div class="dash-card c-green">
        <div class="dash-card-icon">🔥</div>
        <div class="dash-card-num">${streak}</div>
        <div class="dash-card-label">연속 학습일</div>
      </div>
      <div class="dash-card c-orange">
        <div class="dash-card-icon">📝</div>
        <div class="dash-card-num">${sentTotal}</div>
        <div class="dash-card-label">총 예문</div>
      </div>
    </div>

    <div class="dash-title">오늘의 추천 단어</div>
    <div class="today-list">${suggestedHtml}</div>

    <div class="dash-title">중고등 단어</div>
    <div class="dash-levels">
      <div>
        <div class="lv-prog-hdr"><span>중고등 (${total}개)</span><span>100%</span></div>
        <div class="lv-prog-bar"><div class="lv-prog-fill" data-w="100"></div></div>
      </div>
    </div>

    <div class="dash-stat-group">
      <div class="dash-stat-lbl">완전 학습 (정답률 80%+)</div>
      <div class="chip-wrap">${masteredHtml}</div>
    </div>
    <div class="dash-stat-group">
      <div class="dash-stat-lbl">집중 필요 (정답률 50% 미만)</div>
      <div class="chip-wrap">${strugglingHtml}</div>
    </div>
  `;

  requestAnimationFrame(() => {
    document.querySelectorAll('#home-root .lv-prog-fill').forEach(el => {
      el.style.width = el.dataset.w + '%';
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   ── SETTINGS ──
═══════════════════════════════════════════════════════════════ */
function renderSettings() {
  const cfg    = getSettings();
  const apiKey = getApiKey();

  document.getElementById('settings-root').innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">학습 설정</div>

      <div class="field" style="margin-bottom:18px">
        <label for="s-daily-goal">일일 학습 목표</label>
        <div class="settings-inline">
          <input type="number" id="s-daily-goal" class="s-num"
            value="${cfg.dailyGoal ?? 10}" min="5" max="50" aria-label="일일 학습 목표 단어 수" />
          <span style="font-size:13px;color:var(--text-muted)">단어 (5 ~ 50)</span>
        </div>
      </div>

      <div class="field" style="margin-bottom:18px">
        <label>퀴즈 기본 모드</label>
        <div class="radio-group">
          <label><input type="radio" name="s-quiz-mode" value="multiple"   ${(cfg.quizMode ?? 'multiple') !== 'subjective' ? 'checked' : ''} /> 객관식 (4지선다)</label>
          <label><input type="radio" name="s-quiz-mode" value="subjective" ${cfg.quizMode === 'subjective' ? 'checked' : ''} /> 주관식 (직접 입력)</label>
        </div>
      </div>

    </div>

    <div class="settings-section">
      <div class="settings-section-title">음성 (TTS)</div>
      <div class="field">
        <label for="s-voice">영어 음성</label>
        <div style="display:flex;gap:6px">
          <select id="s-voice" style="flex:1" aria-label="TTS 음성 선택"><option value="">-- 불러오는 중... --</option></select>
          <button class="btn btn-ghost" id="s-voice-test" aria-label="선택한 음성으로 테스트 재생">테스트</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Claude AI</div>
      <div class="field">
        <label for="s-api-key">API 키</label>
        <div class="key-row">
          <input type="password" id="s-api-key" value="${escapeHtml(apiKey)}" placeholder="sk-ant-..." aria-label="Claude API 키 입력" />
          <button class="btn btn-ghost" id="s-key-toggle" aria-label="API 키 표시 또는 숨김">표시</button>
        </div>
        <span style="font-size:11px;color:var(--text-muted);margin-top:4px;display:block">
          키는 이 기기에만 저장됩니다. Firebase에 업로드되지 않습니다.
        </span>
      </div>
      <button class="btn btn-primary" id="s-key-save" style="margin-top:12px" aria-label="API 키 저장">저장</button>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">AI 예문 자동생성</div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        예문이 3개 미만인 단어에 대해 Claude AI가 생활회화 예문을 자동으로 생성합니다.<br>
        API 키가 저장되어 있어야 합니다.
      </p>
      <div id="s-batch-progress" style="display:none;margin-bottom:12px">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:6px" id="s-batch-status">0 / 0 단어 처리됨</div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <div id="s-batch-bar" style="height:100%;background:var(--primary);width:0%;transition:width 0.3s"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="s-batch-start" aria-label="AI 예문 자동생성 시작">AI 예문 자동생성 시작</button>
        <button class="btn btn-danger" id="s-batch-stop" style="display:none" aria-label="AI 예문 자동생성 중지">중지</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">데이터 관리</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" id="s-export-words" aria-label="단어장을 CSV로 내보내기">단어장 CSV</button>
        <button class="btn btn-ghost" id="s-export-sents" aria-label="예문을 CSV로 내보내기">예문 CSV</button>
        <button class="btn btn-ghost" id="s-reset-stats"  aria-label="학습 기록만 초기화">학습 기록 초기화</button>
        <button class="btn btn-danger" id="s-reset-words" aria-label="단어만 삭제">단어만 삭제</button>
        <button class="btn btn-danger" id="s-reset-sents" aria-label="예문만 삭제">예문만 삭제</button>
        <button class="btn btn-danger" id="s-reset-all"   aria-label="전체 데이터 초기화">전체 초기화</button>
      </div>
    </div>
  `;

  // 설정 필드 하나 즉시 저장하는 헬퍼
  function saveCfg(key, value) {
    const c = getSettings(); c[key] = value; saveSettings(c);
  }

  // 일일 목표 즉시 저장
  document.getElementById('s-daily-goal').addEventListener('input', function() {
    const v = Math.max(5, Math.min(50, parseInt(this.value, 10) || 10));
    this.value = v;
    saveCfg('dailyGoal', v);
  });

  // 퀴즈 모드 라디오
  document.querySelectorAll('input[name="s-quiz-mode"]').forEach(r => {
    r.addEventListener('change', () => { saveCfg('quizMode', r.value); showToast('설정이 저장되었습니다.'); });
  });

  // TTS 음성 목록 로드 (품질순 정렬)
  function loadVoices() {
    const sel = document.getElementById('s-voice');
    if (!sel) return;
    const all    = (speechSynthesis.getVoices() || []).filter(v => v.lang.startsWith('en'));
    const saved  = getSettings().voiceName;
    const sorted = [...all].sort((a, b) => _voiceQuality(b) - _voiceQuality(a));

    const QLABEL = { 4: '🌟 Neural', 3: '✨ Enhanced', 2: '☁️ Online', 1: '💻 Local', 0: '💻 Local' };
    sel.innerHTML = sorted.length
      ? sorted.map(v => {
          const ql  = QLABEL[_voiceQuality(v)] ?? '';
          const sel = v.name === saved ? ' selected' : '';
          return `<option value="${escapeHtml(v.name)}"${sel}>[${ql}] ${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`;
        }).join('')
      : '<option value="">사용 가능한 음성 없음</option>';

    // 저장된 음성이 없으면 최상위 음성 자동 선택
    if (!saved && sorted.length) {
      sel.value = sorted[0].name;
      saveCfg('voiceName', sorted[0].name);
    }
  }
  loadVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;

  // 음성 선택 즉시 저장 + 테스트 발음
  document.getElementById('s-voice').addEventListener('change', function() {
    saveCfg('voiceName', this.value);
    if (this.value) speakText('Hello, this is a test.', this.value);
  });
  document.getElementById('s-voice-test').addEventListener('click', () => {
    const v = document.getElementById('s-voice').value || getSettings().voiceName;
    speakText('Hello! Nice to meet you. How are you today?', v);
  });

  // API 키 표시/숨김
  document.getElementById('s-key-toggle').addEventListener('click', function() {
    const inp   = document.getElementById('s-api-key');
    const shown = inp.type === 'text';
    inp.type         = shown ? 'password' : 'text';
    this.textContent = shown ? '표시' : '숨김';
  });

  // API 키 저장
  document.getElementById('s-key-save').addEventListener('click', () => {
    saveApiKey(document.getElementById('s-api-key').value.trim());
    showToast('API 키가 저장되었습니다.');
  });

  // AI 배치 예문 자동생성
  let batchStop = false;

  document.getElementById('s-batch-start').addEventListener('click', async function() {
    if (!getApiKey()) { showToast('먼저 Claude API 키를 저장해주세요.'); return; }

    const words   = getWords();
    const sents   = getSentences();
    const cntMap  = new Map();
    sents.forEach(s => cntMap.set(s.wordId, (cntMap.get(s.wordId) ?? 0) + 1));
    const targets = words.filter(w => (cntMap.get(w.id) ?? 0) < 3);

    if (targets.length === 0) { showToast('모든 단어에 예문이 이미 3개 이상 있습니다.'); return; }

    batchStop = false;
    this.disabled = true;
    const stopBtn  = document.getElementById('s-batch-stop');
    const progress = document.getElementById('s-batch-progress');
    const status   = document.getElementById('s-batch-status');
    const bar      = document.getElementById('s-batch-bar');
    if (stopBtn)  stopBtn.style.display  = '';
    if (progress) progress.style.display = '';

    const total = targets.length;
    let done = 0;

    for (const word of targets) {
      if (batchStop) break;

      if (status) status.textContent = `${done} / ${total} 단어 처리됨`;
      if (bar)    bar.style.width    = `${Math.round(done / total * 100)}%`;

      const have = (getSentences().filter(s => s.wordId === word.id)).length;
      const need = 3 - have;
      if (need <= 0) { done++; continue; }

      const prompt =
        `Generate exactly ${need} short natural conversational English example sentence(s) for the word "${word.word}" (${word.pos || 'n'}, Korean meaning: "${word.meaning}").\n` +
        `Each sentence should be simple everyday conversation suitable for Korean learners.\n` +
        `Respond ONLY with a JSON array, no other text:\n` +
        `[{"en":"English sentence here","ko":"한국어 번역"}]`;

      const result = await callClaude(prompt);
      if (result) {
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) {
            const arr = JSON.parse(match[0]);
            if (Array.isArray(arr)) {
              const all = getSentences();
              arr.slice(0, need).forEach(item => {
                if (item.en && item.ko)
                  all.push({ id: crypto.randomUUID(), wordId: word.id, en: item.en.trim(), ko: item.ko.trim() });
              });
              saveSentences(all);
            }
          }
        } catch (_) { /* JSON 파싱 실패 — 건너뜀 */ }
      }
      done++;
      await new Promise(r => setTimeout(r, 400));
    }

    if (status) status.textContent = `${done} / ${total} 단어 처리됨 — ${batchStop ? '중단됨' : '완료'}`;
    if (bar)    bar.style.width    = `${Math.round(done / total * 100)}%`;
    this.disabled = false;
    if (stopBtn) stopBtn.style.display = 'none';
    showToast(batchStop ? `AI 예문 생성 중단 (${done}개 처리)` : `AI 예문 생성 완료: ${done}개 단어 처리됨`);
  });

  document.getElementById('s-batch-stop').addEventListener('click', () => { batchStop = true; });

  // 단어장 CSV 내보내기
  document.getElementById('s-export-words').addEventListener('click', () => {
    const rows = [['word','pos','meaning','level']];
    getWords().forEach(w => rows.push([w.word, w.pos, w.meaning, w.difficulty]));
    downloadCsv(rows, 'everword_words.csv');
    showToast('단어장 CSV를 내보냈습니다.');
  });

  // 예문 CSV 내보내기
  document.getElementById('s-export-sents').addEventListener('click', () => {
    const wordMap = new Map(getWords().map(w => [w.id, w.word]));
    const rows    = [['word','english','korean']];
    getSentences().forEach(s => rows.push([wordMap.get(s.wordId) ?? '', s.en, s.ko]));
    downloadCsv(rows, 'everword_sentences.csv');
    showToast('예문 CSV를 내보냈습니다.');
  });

  // 학습 기록만 초기화 (단어/예문 유지)
  document.getElementById('s-reset-stats').addEventListener('click', () => {
    if (!confirm('학습 기록을 초기화하시겠습니까? 단어 데이터는 유지됩니다.')) return;
    saveWords(getWords().map(({ stats, ...rest }) => rest));
    const c = getSettings(); c.streak = 0; c.lastStudyDate = '';
    saveSettings(c);
    showToast('학습 기록이 초기화되었습니다.');
  });

  // 단어만 삭제
  document.getElementById('s-reset-words').addEventListener('click', () => {
    const count = getWords().length;
    if (!count) { showToast('삭제할 단어가 없습니다.'); return; }
    if (!confirm(`단어 ${count}개를 모두 삭제합니다. 되돌릴 수 없습니다.\n계속하시겠습니까?`)) return;
    clearWords();
    showToast('단어가 모두 삭제되었습니다.');
    renderSettings();
  });

  // 예문만 삭제
  document.getElementById('s-reset-sents').addEventListener('click', () => {
    const count = getSentences().length;
    if (!count) { showToast('삭제할 예문이 없습니다.'); return; }
    if (!confirm(`예문 ${count}개를 모두 삭제합니다. 되돌릴 수 없습니다.\n계속하시겠습니까?`)) return;
    clearSentences();
    showToast('예문이 모두 삭제되었습니다.');
    renderSettings();
  });

  // 전체 데이터 초기화 (2단계 확인)
  document.getElementById('s-reset-all').addEventListener('click', () => {
    if (!confirm('모든 데이터가 삭제됩니다. 되돌릴 수 없습니다.\n계속하시겠습니까?')) return;
    if (!confirm('정말로 모든 데이터를 삭제하시겠습니까?')) return;
    clearAll().finally(() => location.reload());
  });
}

/* ═══════════════════════════════════════════════════════════════
   ── CLAUDE AI ──
═══════════════════════════════════════════════════════════════ */
async function callClaude(prompt) {
  const key = getApiKey();
  if (!key) { showToast('설정에서 Claude API 키를 먼저 입력해주세요.'); return null; }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`API 오류: ${err.error?.message ?? res.status}`);
      return null;
    }

    const data = await res.json();
    return data.content[0].text;
  } catch(e) {
    console.error(e);
    showToast('네트워크 오류가 발생했습니다.');
    return null;
  }
}

async function generateExamples(word, meaning, pos) {
  const posLabel = POS_LABEL[pos] ?? pos;
  const text = await callClaude(
    `Create 2 natural English example sentences for the vocabulary word "${word}" (${posLabel}, Korean: ${meaning}).\n` +
    `Return ONLY a JSON array, no other text:\n` +
    `[{"en":"sentence 1","ko":"한국어 번역 1"},{"en":"sentence 2","ko":"한국어 번역 2"}]`
  );
  if (!text) return null;
  try {
    const match = text.match(/\[[\s\S]*?\]/);
    return match ? JSON.parse(match[0]) : null;
  } catch(e) {
    console.error(e);
    showToast('AI 응답 파싱에 실패했습니다.');
    return null;
  }
}


/* ═══════════════════════════════════════════════════════════════
   Boot
═══════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  await _openIDB();
  await _loadAll();
  navigate();
});
window.addEventListener('hashchange', navigate);
