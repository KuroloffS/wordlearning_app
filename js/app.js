import {
  GRADES,
  MINUTE,
  newCard,
  schedule,
  previewIntervals,
  getDueCards,
  getNewCards,
  isNew,
  isDue,
  cardStatus,
  forecast,
  formatInterval,
  parseIntervalList,
  gradeTypedAnswer,
  parseBulk,
  makeId,
} from './srs.js';
import { load, save, logReview, todayKey, streak, normalizeState } from './storage.js';

// ---------- state ----------
let state = load();
const $ = (id) => document.getElementById(id);
const now = () => Date.now();

function persist() {
  if (!save(state)) toast('Could not save — storage is full or blocked');
  refreshBadge();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

function deckName(id) {
  return state.decks.find((d) => d.id === id)?.name ?? 'Unknown';
}

function cardsInDeck(deckId) {
  return deckId ? state.cards.filter((c) => c.deckId === deckId) : state.cards;
}

function newLeftToday() {
  const learned = state.log[todayKey()]?.learned || 0;
  return Math.max(0, state.settings.newPerDay - learned);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------- routing ----------
const VIEWS = ['study', 'words', 'add', 'stats', 'settings'];
function route() {
  const v = location.hash.slice(1);
  const view = VIEWS.includes(v) ? v : 'study';
  for (const name of VIEWS) $('view-' + name).hidden = name !== view;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  if (view !== 'study' && session) endSession(false);
  ({ study: renderStudyHome, words: renderWords, add: renderAdd, stats: renderStats, settings: renderSettings })[view]();
}
window.addEventListener('hashchange', route);

function fillDeckSelect(sel, { includeAll = false, value } = {}) {
  const current = value ?? sel.value;
  sel.innerHTML =
    (includeAll ? '<option value="">All decks</option>' : '') +
    state.decks.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

// ---------- study home ----------
function renderStudyHome() {
  $('study-home').hidden = !!session;
  $('session').hidden = !session;
  $('session-done').hidden = true;
  if (session) return;

  fillDeckSelect($('study-deck'), { includeAll: true });
  $('study-mode').value = state.settings.mode;
  $('study-direction').value = state.settings.direction;

  const cards = cardsInDeck($('study-deck').value);
  const due = getDueCards(cards).length;
  const newCount = Math.min(newLeftToday(), getNewCards(cards).length);
  $('count-due').textContent = due;
  $('count-new').textContent = newCount;
  $('count-total').textContent = cards.length;
  $('start-btn').disabled = due + newCount === 0;
  $('start-btn').textContent = due + newCount === 0 ? 'Nothing due' : `Start (${due + newCount})`;
  $('cram-btn').disabled = cards.length === 0;
  $('empty-hint').hidden = state.cards.length > 0;
  $('next-due-text').textContent = nextDueText(cards);
}

function nextDueText(cards) {
  const upcoming = cards.filter((c) => !isNew(c) && c.due > now()).sort((a, b) => a.due - b.due)[0];
  if (getDueCards(cards).length > 0) return 'Words are waiting for review — now is the best time to repeat them.';
  if (upcoming) return `Next review in ${formatInterval(upcoming.due - now())}.`;
  return '';
}

$('study-deck').addEventListener('change', renderStudyHome);
$('study-mode').addEventListener('change', (e) => {
  state.settings.mode = e.target.value;
  persist();
});
$('study-direction').addEventListener('change', (e) => {
  state.settings.direction = e.target.value;
  persist();
});

// ---------- session ----------
let session = null;
// session = { queue: [{id, reverse}], current, done, correct, cram, revealed, suggested, total }

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickReverse() {
  const d = state.settings.direction;
  return d === 'reverse' ? true : d === 'mixed' ? Math.random() < 0.5 : false;
}

function startSession(cram = false) {
  const cards = cardsInDeck($('study-deck').value);
  let list;
  if (cram) {
    list = shuffle([...cards]);
  } else {
    const due = getDueCards(cards);
    const fresh = getNewCards(cards, newLeftToday());
    // Interleave new words between reviews so the session isn't front-loaded.
    list = [];
    const step = fresh.length ? Math.max(1, Math.floor(due.length / fresh.length)) : 0;
    let n = 0;
    due.forEach((c, i) => {
      list.push(c);
      if (step && (i + 1) % step === 0 && n < fresh.length) list.push(fresh[n++]);
    });
    while (n < fresh.length) list.push(fresh[n++]);
  }
  if (list.length === 0) return;
  session = {
    queue: list.map((c) => ({ id: c.id, reverse: pickReverse() })),
    current: null,
    done: 0,
    correct: 0,
    cram,
  };
  $('study-home').hidden = true;
  $('session-done').hidden = true;
  $('session').hidden = false;
  nextCard();
}

function currentCard() {
  return state.cards.find((c) => c.id === session.current.id);
}

function nextCard() {
  // Skip cards deleted mid-session.
  while (session.queue.length && !state.cards.some((c) => c.id === session.queue[0].id)) session.queue.shift();
  if (session.queue.length === 0) return finishSession();
  session.current = session.queue.shift();
  session.revealed = false;
  session.suggested = null;
  renderCard();
}

function renderCard() {
  const card = currentCard();
  const rev = session.current.reverse;
  // Drop focus from the previous card's buttons so Space/Enter don't re-click them.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  let mode = state.settings.mode;
  if (mode === 'choice' && state.cards.length < 3) mode = 'flip';
  session.mode = mode;

  const total = session.done + session.queue.length + 1;
  $('progress-bar').style.width = `${(session.done / total) * 100}%`;
  $('session-left').textContent = `${session.queue.length + 1} left`;

  const status = session.cram ? 'practice' : isNew(card) ? 'new word' : 'review';
  $('card-tag').textContent = `${status} · ${rev ? 'translation → word' : 'word → translation'}`;
  $('card-prompt').textContent = rev ? card.translation : card.word;
  $('card-answer').textContent = rev ? card.word : card.translation;
  $('card-answer').hidden = true;
  $('card-example').textContent = card.example;
  $('card-example').hidden = true;
  $('feedback').hidden = true;
  $('grades').hidden = true;
  $('grades').querySelectorAll('button').forEach((b) => b.classList.remove('suggested'));
  $('show-btn').hidden = mode !== 'flip';
  $('type-form').hidden = mode !== 'type';
  $('choices').hidden = mode !== 'choice';

  if (mode === 'type') {
    $('type-input').value = '';
    $('type-input').disabled = false;
    setTimeout(() => $('type-input').focus(), 0);
  }
  if (mode === 'choice') renderChoices(card, rev);
  if (!rev && state.settings.autoSpeak) speak(card.word);
}

function renderChoices(card, rev) {
  const answerOf = (c) => (rev ? c.word : c.translation);
  const correct = answerOf(card);
  const pool = shuffle(state.cards.filter((c) => c.id !== card.id && answerOf(c) !== correct));
  const options = shuffle([correct, ...[...new Set(pool.map(answerOf))].slice(0, 3)]);
  const box = $('choices');
  box.innerHTML = options
    .map((o, i) => `<button type="button" data-val="${escapeHtml(o)}"><kbd>${i + 1}</kbd> ${escapeHtml(o)}</button>`)
    .join('');
  box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => chooseOption(b)));
}

function chooseOption(btn) {
  if (session.revealed) return;
  const correct = $('card-answer').textContent;
  const ok = btn.dataset.val === correct;
  $('choices').querySelectorAll('button').forEach((b) => {
    if (b.dataset.val === correct) b.classList.add('correct');
    else if (b === btn) b.classList.add('wrong');
  });
  reveal(ok ? GRADES.GOOD : GRADES.AGAIN);
}

function reveal(suggested = null) {
  if (session.revealed) return;
  session.revealed = true;
  session.suggested = suggested;
  const card = currentCard();
  $('card-answer').hidden = false;
  $('card-example').hidden = !card.example;
  $('show-btn').hidden = true;
  $('grades').hidden = false;
  const previews = previewIntervals(card, state.settings.intervals);
  $('grades')
    .querySelectorAll('button')
    .forEach((b) => {
      const g = Number(b.dataset.grade);
      b.querySelector('small').textContent = session.cram ? '' : formatInterval(previews[g]);
      b.classList.toggle('suggested', g === suggested);
    });
  if (session.current.reverse && state.settings.autoSpeak) speak(card.word);
}

function grade(g) {
  if (!session || !session.revealed) return;
  const card = currentCard();
  const wasNew = isNew(card);
  if (session.cram) {
    if (g === GRADES.AGAIN) session.queue.push({ ...session.current });
  } else {
    const updated = schedule(card, g, now(), state.settings.intervals);
    state.cards = state.cards.map((c) => (c.id === card.id ? updated : c));
    logReview(state, { correct: g >= GRADES.HARD, learnedNew: wasNew });
    // Words due again within a few minutes come back in this same session.
    if (updated.due - now() <= 15 * MINUTE) {
      const pos = Math.min(session.queue.length, 4 + Math.floor(Math.random() * 3));
      session.queue.splice(pos, 0, { id: card.id, reverse: pickReverse() });
    }
    persist();
  }
  session.done++;
  if (g >= GRADES.HARD) session.correct++;
  nextCard();
}

function finishSession() {
  const s = session;
  session = null;
  $('session').hidden = true;
  $('session-done').hidden = false;
  const pct = s.done ? Math.round((s.correct / s.done) * 100) : 0;
  $('done-summary').textContent = `You answered ${s.done} card${s.done === 1 ? '' : 's'} — ${pct}% correct.`;
  $('done-next').textContent = nextDueText(cardsInDeck($('study-deck').value));
}

function endSession(showHome = true) {
  session = null;
  if (showHome) renderStudyHome();
}

$('start-btn').addEventListener('click', () => startSession(false));
$('cram-btn').addEventListener('click', () => startSession(true));
$('end-session').addEventListener('click', () => endSession());
$('done-btn').addEventListener('click', renderStudyHome);
$('show-btn').addEventListener('click', () => reveal());
$('grades').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-grade]');
  if (b) grade(Number(b.dataset.grade));
});
$('type-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (session.revealed) return grade(session.suggested ?? GRADES.GOOD);
  const card = currentCard();
  const expected = session.current.reverse ? card.word : card.translation;
  const typed = $('type-input').value;
  const g = gradeTypedAnswer(typed, expected);
  const fb = $('feedback');
  fb.hidden = false;
  fb.className = 'feedback ' + (g === GRADES.GOOD ? 'ok' : g === GRADES.HARD ? 'close' : 'bad');
  fb.textContent = g === GRADES.GOOD ? '✓ Correct' : g === GRADES.HARD ? '≈ Almost — check the spelling' : `✗ You typed “${typed || '…'}”`;
  $('type-input').disabled = true;
  reveal(g);
});
$('speak-btn').addEventListener('click', () => {
  const card = session && currentCard();
  if (card) speak(card.word);
});

document.addEventListener('keydown', (e) => {
  if (!session || $('view-study').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target.tagName === 'INPUT' && !e.target.disabled;
  if (typing) return; // the form handles Enter
  if ((e.key === ' ' || e.key === 'Enter') && !session.revealed && session.mode === 'flip') {
    e.preventDefault();
    reveal();
  } else if (e.key === 'Enter' && session.revealed) {
    e.preventDefault();
    grade(session.suggested ?? GRADES.GOOD);
  } else if (['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    const i = Number(e.key) - 1;
    if (!session.revealed && session.mode === 'choice') {
      const btn = $('choices').querySelectorAll('button')[i];
      if (btn) chooseOption(btn);
    } else if (session.revealed) {
      grade(i);
    }
  } else if (e.key.toLowerCase() === 's') {
    speak(currentCard().word);
  }
});

// ---------- speech ----------
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = state.settings.speakLang;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === u.lang);
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

// ---------- words ----------
function renderWords() {
  fillDeckSelect($('filter-deck'), { includeAll: true });
  const q = $('search').value.trim().toLowerCase();
  const deck = $('filter-deck').value;
  const st = $('filter-status').value;
  const t = now();
  const intervals = state.settings.intervals;
  const rows = cardsInDeck(deck)
    .filter((c) => !q || c.word.toLowerCase().includes(q) || c.translation.toLowerCase().includes(q))
    .filter((c) => !st || (st === 'due' ? isDue(c, t) : cardStatus(c, intervals) === st))
    .sort((a, b) => b.createdAt - a.createdAt);

  $('words-count').textContent = `${rows.length} of ${state.cards.length} words`;
  $('words-body').innerHTML = rows
    .map((c) => {
      const s = cardStatus(c, intervals);
      const next = isNew(c) ? '—' : c.due <= t ? '<strong>now</strong>' : 'in ' + formatInterval(c.due - t);
      return `<tr>
        <td><strong>${escapeHtml(c.word)}</strong>${c.example ? `<br><small class="muted">${escapeHtml(c.example)}</small>` : ''}</td>
        <td>${escapeHtml(c.translation)}</td>
        <td><span class="status ${s}">${s}${s !== 'new' ? ` · ${c.stage}/${intervals.length}` : ''}</span></td>
        <td>${next}</td>
        <td class="actions"><button data-edit="${c.id}">Edit</button> <button data-del="${c.id}" class="danger">✕</button></td>
      </tr>`;
    })
    .join('');

  $('deck-list').innerHTML = state.decks
    .map((d) => {
      const n = state.cards.filter((c) => c.deckId === d.id).length;
      return `<li><span>${escapeHtml(d.name)} <small class="muted">(${n})</small></span>
        <span><button data-rename-deck="${d.id}">Rename</button>
        ${state.decks.length > 1 ? `<button class="danger" data-del-deck="${d.id}">Delete</button>` : ''}</span></li>`;
    })
    .join('');
}

$('search').addEventListener('input', renderWords);
$('filter-deck').addEventListener('change', renderWords);
$('filter-status').addEventListener('change', renderWords);

$('words-body').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  const edit = e.target.closest('[data-edit]');
  if (del) {
    const card = state.cards.find((c) => c.id === del.dataset.del);
    if (card && confirm(`Delete “${card.word}”?`)) {
      state.cards = state.cards.filter((c) => c.id !== card.id);
      persist();
      renderWords();
    }
  } else if (edit) {
    openEdit(edit.dataset.edit);
  }
});

function openEdit(id) {
  const card = state.cards.find((c) => c.id === id);
  if (!card) return;
  const dlg = $('edit-dialog');
  $('edit-word').value = card.word;
  $('edit-translation').value = card.translation;
  $('edit-example').value = card.example || '';
  fillDeckSelect($('edit-deck'), { value: card.deckId });
  dlg.onclose = () => {
    const action = dlg.returnValue;
    if (action !== 'save' && action !== 'reset') return;
    state.cards = state.cards.map((c) => {
      if (c.id !== id) return c;
      const updated = {
        ...c,
        word: $('edit-word').value.trim() || c.word,
        translation: $('edit-translation').value.trim() || c.translation,
        example: $('edit-example').value.trim(),
        deckId: $('edit-deck').value,
      };
      if (action === 'reset') Object.assign(updated, { stage: 0, reps: 0, lapses: 0, due: now(), lastReviewed: null });
      return updated;
    });
    persist();
    renderWords();
    toast(action === 'reset' ? 'Progress reset' : 'Saved');
  };
  dlg.returnValue = '';
  dlg.showModal();
}

$('deck-list').addEventListener('click', (e) => {
  const ren = e.target.closest('[data-rename-deck]');
  const del = e.target.closest('[data-del-deck]');
  if (ren) {
    const deck = state.decks.find((d) => d.id === ren.dataset.renameDeck);
    const name = prompt('Deck name', deck.name)?.trim();
    if (name) {
      deck.name = name;
      persist();
      renderWords();
    }
  } else if (del) {
    const id = del.dataset.delDeck;
    const n = state.cards.filter((c) => c.deckId === id).length;
    if (!confirm(`Delete deck “${deckName(id)}”${n ? ` and its ${n} words` : ''}?`)) return;
    state.decks = state.decks.filter((d) => d.id !== id);
    state.cards = state.cards.filter((c) => c.deckId !== id);
    persist();
    renderWords();
  }
});

$('deck-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('deck-name').value.trim();
  if (!name) return;
  state.decks.push({ id: makeId(), name });
  $('deck-name').value = '';
  persist();
  renderWords();
});

// ---------- add ----------
function renderAdd() {
  const last = state.settings.lastDeck;
  fillDeckSelect($('add-deck'), { value: last });
  fillDeckSelect($('bulk-deck'), { value: last });
  $('add-word').focus();
}

function isDuplicate(word, deckId) {
  const w = word.trim().toLowerCase();
  return state.cards.some((c) => c.deckId === deckId && c.word.toLowerCase() === w);
}

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const word = $('add-word').value.trim();
  const translation = $('add-translation').value.trim();
  const deckId = $('add-deck').value;
  if (!word || !translation) return;
  if (isDuplicate(word, deckId) && !confirm(`“${word}” is already in this deck. Add anyway?`)) return;
  state.cards.push(newCard({ word, translation, example: $('add-example').value, deckId }));
  state.settings.lastDeck = deckId;
  persist();
  $('add-form').reset();
  $('add-deck').value = deckId;
  $('add-msg').textContent = `Added “${word}”. It will appear among today's new words.`;
  $('add-word').focus();
});

$('bulk-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const deckId = $('bulk-deck').value;
  const items = parseBulk($('bulk-text').value);
  let added = 0;
  let skipped = 0;
  const t = now();
  items.forEach((it, i) => {
    if (isDuplicate(it.word, deckId)) return skipped++;
    // Small createdAt offsets keep the original order for "new" cards.
    state.cards.push(newCard({ ...it, deckId }, t + i));
    added++;
  });
  state.settings.lastDeck = deckId;
  persist();
  $('bulk-msg').textContent = items.length
    ? `Imported ${added} word${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}.`
    : 'Nothing recognised — use “word - translation” on each line.';
  if (added) $('bulk-text').value = '';
});

// ---------- stats ----------
function bars(el, values, labels) {
  const max = Math.max(1, ...values);
  el.innerHTML = values
    .map(
      (v, i) => `<div class="bar" title="${escapeHtml(labels[i])}: ${v}">
        <span class="val">${v || ''}</span>
        <div class="fill" style="height:${(v / max) * 100}%"></div>
        <span>${escapeHtml(labels[i])}</span></div>`,
    )
    .join('');
}

function renderStats() {
  const intervals = state.settings.intervals;
  const counts = { new: 0, learning: 0, known: 0, mastered: 0 };
  state.cards.forEach((c) => counts[cardStatus(c, intervals)]++);
  const today = state.log[todayKey()] || { reviews: 0, correct: 0 };
  const allReviews = Object.values(state.log).reduce((a, e) => a + e.reviews, 0);
  const allCorrect = Object.values(state.log).reduce((a, e) => a + e.correct, 0);
  const tiles = [
    ['Total words', state.cards.length],
    ['Due now', getDueCards(state.cards).length],
    ['Reviews today', today.reviews],
    ['Day streak', streak(state.log)],
    ['New', counts.new],
    ['Learning', counts.learning],
    ['Known', counts.known],
    ['Mastered', counts.mastered],
    ['Accuracy', allReviews ? Math.round((allCorrect / allReviews) * 100) + '%' : '—'],
  ];
  $('stat-grid').innerHTML = tiles
    .map(([l, v]) => `<div class="card"><div class="big">${v}</div><div class="muted">${l}</div></div>`)
    .join('');

  const fc = forecast(state.cards, now(), 7);
  const dayLabel = (offset) => {
    if (offset === 0) return 'Today';
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  };
  bars($('forecast'), fc, fc.map((_, i) => dayLabel(i)));

  const hist = [];
  const histLabels = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    hist.push(state.log[todayKey(d.getTime())]?.reviews || 0);
    histLabels.push(String(d.getDate()));
  }
  bars($('history'), hist, histLabels);

  const stageCounts = new Array(intervals.length + 1).fill(0);
  state.cards.forEach((c) => {
    if (!isNew(c)) stageCounts[Math.min(c.stage, intervals.length)]++;
  });
  bars(
    $('stages'),
    stageCounts,
    stageCounts.map((_, i) => (i === 0 ? 'relearn' : formatInterval(intervals[i - 1]))),
  );
}

// ---------- settings ----------
const COMMON_LANGS = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'pt-BR', 'ru-RU', 'uk-UA', 'tr-TR', 'pl-PL', 'zh-CN', 'ja-JP', 'ko-KR', 'ar-SA'];

function renderSettings() {
  const s = state.settings;
  $('set-intervals').value = s.intervals.map(formatInterval).join(', ');
  $('set-newperday').value = s.newPerDay;
  $('set-autospeak').checked = s.autoSpeak;
  $('set-notify').checked = s.notifications;
  $('set-theme').value = s.theme;
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices().map((v) => v.lang) : [];
  const langs = [...new Set([...COMMON_LANGS, ...voices, s.speakLang])].sort();
  $('set-lang').innerHTML = langs.map((l) => `<option>${escapeHtml(l)}</option>`).join('');
  $('set-lang').value = s.speakLang;
}
if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    if (!$('view-settings').hidden) renderSettings();
  });
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('settings-msg');
  let intervals;
  try {
    intervals = parseIntervalList($('set-intervals').value);
  } catch (err) {
    msg.textContent = err.message;
    return;
  }
  const s = state.settings;
  s.intervals = intervals;
  // Cards beyond the new last stage are capped to it.
  state.cards.forEach((c) => {
    if (c.stage > intervals.length) c.stage = intervals.length;
  });
  s.newPerDay = Math.max(0, Math.min(500, parseInt($('set-newperday').value, 10) || 0));
  s.speakLang = $('set-lang').value;
  s.autoSpeak = $('set-autospeak').checked;
  s.theme = $('set-theme').value;
  s.notifications = $('set-notify').checked;
  if (s.notifications && 'Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') {
      s.notifications = false;
      $('set-notify').checked = false;
      toast('Notifications were blocked by the browser');
    }
  }
  applyTheme();
  persist();
  renderSettings();
  msg.textContent = 'Saved.';
});

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-btn').addEventListener('click', () => {
  download(`wordlearning-${todayKey()}.json`, JSON.stringify(state, null, 2), 'application/json');
});
$('export-csv-btn').addEventListener('click', () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['word', 'translation', 'example', 'deck', 'stage', 'next_review'].join(',')];
  state.cards.forEach((c) =>
    lines.push(
      [c.word, c.translation, c.example, deckName(c.deckId), c.stage, isNew(c) ? '' : new Date(c.due).toISOString()]
        .map(q)
        .join(','),
    ),
  );
  download(`wordlearning-${todayKey()}.csv`, lines.join('\n'), 'text/csv');
});
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards)) throw new Error('No cards in this file');
    if (!confirm(`Replace your current data with ${data.cards.length} words from the backup?`)) return;
    state = normalizeState(data);
    persist();
    applyTheme();
    $('backup-msg').textContent = `Imported ${state.cards.length} words.`;
    renderSettings();
  } catch (err) {
    $('backup-msg').textContent = 'Import failed: ' + err.message;
  }
});
$('reset-btn').addEventListener('click', () => {
  if (!confirm('Delete ALL words, decks and progress? This cannot be undone.')) return;
  state = normalizeState(null);
  persist();
  applyTheme();
  $('backup-msg').textContent = 'All data deleted.';
  renderSettings();
});

// ---------- sample data ----------
const SAMPLE = `apple - яблоко - An apple a day keeps the doctor away.
to borrow - занимать, брать взаймы - Can I borrow your pen?
reliable - надёжный - She is a reliable friend.
to achieve - достигать - He achieved his goal.
weather - погода - The weather is nice today.
to remember - помнить, вспоминать - I remember your name.
library - библиотека - I study at the library.
honest - честный - Be honest with me.
to improve - улучшать - Practice will improve your English.
journey - путешествие, поездка - It was a long journey.
to explain - объяснять - Can you explain this word?
enough - достаточно - Is that enough?`;

$('sample-btn').addEventListener('click', () => {
  const t = now();
  parseBulk(SAMPLE).forEach((it, i) => state.cards.push(newCard({ ...it, deckId: state.decks[0].id }, t + i)));
  persist();
  renderStudyHome();
  toast('Sample words added');
});

// ---------- due badge & reminders ----------
let lastDueCount = -1;
function refreshBadge() {
  const due = getDueCards(state.cards).length;
  const badge = $('due-badge');
  badge.hidden = due === 0;
  badge.textContent = due;
  document.title = due ? `(${due}) WordLearning` : 'WordLearning';
  if (
    state.settings.notifications &&
    lastDueCount >= 0 &&
    due > lastDueCount &&
    !session &&
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.visibilityState !== 'visible'
  ) {
    new Notification('Time to repeat your words', { body: `${due} word${due === 1 ? '' : 's'} waiting for review`, icon: 'icon.svg' });
  }
  lastDueCount = due;
}

setInterval(() => {
  refreshBadge();
  if (!session && !$('view-study').hidden && $('session-done').hidden) renderStudyHome();
}, 30 * 1000);

// Keep tabs in sync if the app is open twice.
window.addEventListener('storage', (e) => {
  if (e.key === 'wordlearning:v1' && !session) {
    state = load();
    route();
  }
});

// ---------- boot ----------
applyTheme();
refreshBadge();
route();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
