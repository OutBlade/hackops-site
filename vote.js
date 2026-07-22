/* ============================================================
   hack//ops - op//002 vote widget
   A small state machine (locked -> open -> closed) rendered into
   #vote-body. Real enforcement of the window lives in Firestore
   Security Rules (server clock); this file only decides what to
   show and, while open, submits one transactional +1 per click.
   ============================================================ */
import { db, EVENT_ID } from "./firebase-init.js";
import {
  doc, getDoc, getDocs, collection, runTransaction, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const VOTED_KEY = `hackops-voted-${EVENT_ID}`;
const root = document.getElementById('vote-body');
if (root) boot();

async function boot() {
  let cfg;
  try {
    const snap = await getDoc(doc(db, 'events', EVENT_ID, 'config', 'vote'));
    if (!snap.exists()) { renderMissing(); return; }
    cfg = snap.data();
  } catch (e) {
    renderMissing();
    return;
  }

  const unlockAt = cfg.unlockAt.toDate();
  const expiresAt = cfg.expiresAt.toDate();
  tick(unlockAt, expiresAt);
  // re-check every 15s so the widget flips state on its own, live,
  // without a reload -- someone can be sitting on the page at 19:00
  setInterval(() => tick(unlockAt, expiresAt), 15000);
}

let currentPhase = null;
function tick(unlockAt, expiresAt) {
  const now = new Date();
  const phase = now < unlockAt ? 'locked' : now < expiresAt ? 'open' : 'closed';
  if (phase === currentPhase) {
    if (phase === 'locked') renderLocked(unlockAt); // keep the countdown fresh
    return;
  }
  currentPhase = phase;
  if (phase === 'locked') renderLocked(unlockAt);
  else if (phase === 'open') renderOpen();
  else renderClosed();
}

function fmtBerlin(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit'
  }).format(d) + ' CET/CEST';
}

function countdown(to) {
  let s = Math.max(0, Math.round((to - new Date()) / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

let countdownTimer = null;
function renderLocked(unlockAt) {
  clearInterval(countdownTimer);
  root.innerHTML = `
    <p class="mono">status: sealed</p>
    <h3 class="vote-h">voting opens</h3>
    <div class="vote-countdown" id="vote-cd">${countdown(unlockAt)}</div>
    <p class="vote-sub">${fmtBerlin(unlockAt)}</p>
  `;
  const cd = document.getElementById('vote-cd');
  countdownTimer = setInterval(() => {
    if (cd) cd.textContent = countdown(unlockAt);
  }, 1000);
}

async function renderOpen() {
  clearInterval(countdownTimer);
  root.innerHTML = `<p class="mono">status: loading ballot...</p>`;
  let teamDocs;
  try {
    teamDocs = await getDocs(collection(db, 'events', EVENT_ID, 'teams'));
  } catch (e) {
    root.innerHTML = `<p class="mono">status: could not load teams</p>`;
    return;
  }
  const teams = teamDocs.docs.map(d => ({ id: d.id, name: d.data().name }));
  const voted = localStorage.getItem(VOTED_KEY);

  if (!teams.length) {
    root.innerHTML = `<p class="mono">status: open</p><p>No teams registered yet. Check back soon.</p>`;
    return;
  }

  root.innerHTML = `
    <p class="mono">status: open</p>
    <h3 class="vote-h">vote for your favorite build</h3>
    <div class="vote-teams">
      ${teams.map(t => `<button type="button" class="vote-team-btn" data-team="${t.id}" data-interactive
          ${voted ? 'disabled' : ''}>${escapeHtml(t.name)}</button>`).join('')}
    </div>
    <p class="vote-sub" id="vote-msg">${voted ? "you've already voted from this device. thanks!" : 'one vote per device.'}</p>
  `;

  root.querySelectorAll('.vote-team-btn').forEach(btn => {
    btn.addEventListener('click', () => castVote(btn.dataset.team, teams));
  });
}

async function castVote(teamId, teams) {
  if (localStorage.getItem(VOTED_KEY)) return;
  root.querySelectorAll('.vote-team-btn').forEach(b => b.disabled = true);
  const msg = document.getElementById('vote-msg');
  if (msg) msg.textContent = 'casting vote...';
  try {
    const ref = doc(db, 'events', EVENT_ID, 'tallies', teamId);
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const count = snap.exists() ? (snap.data().count || 0) : 0;
      tx.update(ref, { count: count + 1 });
    });
    localStorage.setItem(VOTED_KEY, teamId);
    const team = teams.find(t => t.id === teamId);
    if (msg) msg.textContent = `voted for ${team ? team.name : 'your pick'}. thanks!`;
  } catch (e) {
    if (msg) msg.textContent = 'vote did not go through -- voting may have just closed.';
    root.querySelectorAll('.vote-team-btn').forEach(b => b.disabled = !!localStorage.getItem(VOTED_KEY));
  }
}

async function renderClosed() {
  clearInterval(countdownTimer);
  root.innerHTML = `<p class="mono">status: closed</p><p>Tallying results...</p>`;
  let teamDocs, tallyDocs;
  try {
    [teamDocs, tallyDocs] = await Promise.all([
      getDocs(collection(db, 'events', EVENT_ID, 'teams')),
      getDocs(query(collection(db, 'events', EVENT_ID, 'tallies'), orderBy('count', 'desc')))
    ]);
  } catch (e) {
    root.innerHTML = `<p class="mono">status: closed</p><p>Results are being finalized.</p>`;
    return;
  }
  const names = Object.fromEntries(teamDocs.docs.map(d => [d.id, d.data().name]));
  const rows = tallyDocs.docs.map((d, i) => ({
    rank: i + 1, name: names[d.id] || d.id, count: d.data().count || 0
  }));

  root.innerHTML = `
    <p class="mono">status: final</p>
    <h3 class="vote-h">${rows[0] ? escapeHtml(rows[0].name) + ' wins' : 'results'}</h3>
    <div class="vote-results">
      ${rows.map(r => `
        <div class="vote-results-row${r.rank === 1 ? ' vote-results-win' : ''}">
          <span class="vote-results-rank">${r.rank}</span>
          <span class="vote-results-name">${escapeHtml(r.name)}</span>
          <span class="vote-results-count">${r.count}</span>
        </div>`).join('')}
    </div>
  `;
}

function renderMissing() {
  root.innerHTML = `<p class="mono">status: not configured</p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
