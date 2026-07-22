/* ============================================================
   hack//ops - op//002 vote widget
   A small state machine (locked -> open -> closed) rendered into
   #vote-body. Real enforcement of the window lives in Firestore
   Security Rules (server clock); this file only decides what to
   show and, while open, submits one transactional +1 per confirmed
   vote.

   Voting itself is a two-step, deliberate flow: the in-world card
   shows a single "vote now" button (nothing to fat-finger); tapping
   it opens a fixed-position confirmation modal -- outside the camera
   world, so it renders at a real, full size on any screen -- where a
   team must be picked AND a separate confirm button pressed before
   anything is written.
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

  if (!teams.length) {
    root.innerHTML = `<p class="mono">status: open</p><p>No teams registered yet. Check back soon.</p>`;
    return;
  }

  paintCardForVoteState(teams);
}

// the in-world card: just a button, whatever the local vote state is
function paintCardForVoteState(teams) {
  const voted = localStorage.getItem(VOTED_KEY);
  const votedTeam = voted && teams.find(t => t.id === voted);
  root.innerHTML = voted
    ? `<p class="mono">status: open</p>
       <h3 class="vote-h">you voted</h3>
       <p class="vote-sub">${votedTeam ? 'for ' + escapeHtml(votedTeam.name) + '. ' : ''}thanks for backing a build.</p>
       <button type="button" class="vote-cta-btn" disabled>vote cast</button>`
    : `<p class="mono">status: open</p>
       <h3 class="vote-h">vote for your favorite build</h3>
       <p class="vote-sub">one tap opens a confirmation -- no accidental votes.</p>
       <button type="button" class="vote-cta-btn" id="vote-open-btn" data-interactive>vote now</button>`;

  const openBtn = document.getElementById('vote-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => openModal(teams));
}

/* ---------------- confirmation modal ---------------- */
const backdrop = document.getElementById('vote-modal-backdrop');
const modalTeams = document.getElementById('vote-modal-teams');
const modalConfirm = document.getElementById('vote-modal-confirm');
const modalCancel = document.getElementById('vote-modal-cancel');
const modalClose = document.getElementById('vote-modal-close');
const modalStep = document.getElementById('vote-modal-step');
const modalMsg = document.getElementById('vote-modal-msg');

let modalTeamsData = [];
let pickedTeamId = null;
let voteInFlight = false;
let modalOpenedAt = 0;
let pickedAt = 0;
// no real human moves from "modal just appeared" to "team tapped" to
// "confirm tapped" faster than this; guards against any input burst
// (double-fire, stray replayed event, etc.) chaining select+confirm
// into a single accidental vote -- the whole point of this modal.
const MIN_STEP_MS = 250;

function openModal(teams) {
  if (!backdrop) return;
  modalTeamsData = teams;
  pickedTeamId = null;
  voteInFlight = false;
  modalOpenedAt = performance.now();
  pickedAt = 0;
  modalMsg.textContent = '';
  modalStep.textContent = 'pick a team, then confirm';
  modalConfirm.disabled = true;
  modalConfirm.textContent = 'confirm vote';
  modalTeams.innerHTML = teams.map(t => `
    <button type="button" class="vote-modal-team-btn" data-team="${t.id}" data-interactive>
      <span class="radio" aria-hidden="true"></span>${escapeHtml(t.name)}
    </button>`).join('');
  modalTeams.querySelectorAll('.vote-modal-team-btn').forEach(btn => {
    btn.addEventListener('click', () => pickTeam(btn.dataset.team));
  });
  backdrop.classList.add('open');
}

function closeModal() {
  if (voteInFlight) return; // a vote is mid-flight, do not let it get abandoned mid-write
  backdrop.classList.remove('open');
}

function pickTeam(teamId) {
  if (performance.now() - modalOpenedAt < MIN_STEP_MS) return; // too soon after opening to be a deliberate tap
  pickedTeamId = teamId;
  pickedAt = performance.now();
  modalTeams.querySelectorAll('.vote-modal-team-btn').forEach(btn => {
    btn.classList.toggle('picked', btn.dataset.team === teamId);
  });
  const team = modalTeamsData.find(t => t.id === teamId);
  modalConfirm.disabled = false;
  modalConfirm.textContent = `confirm vote for ${team ? team.name : 'this team'}`;
}

if (modalConfirm) modalConfirm.addEventListener('click', () => {
  if (!pickedTeamId) return;
  if (performance.now() - pickedAt < MIN_STEP_MS) return; // too soon after picking to be a deliberate confirm
  castVote(pickedTeamId, modalTeamsData);
});
if (modalCancel) modalCancel.addEventListener('click', closeModal);
if (modalClose) modalClose.addEventListener('click', closeModal);
if (backdrop) backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

async function castVote(teamId, teams) {
  if (localStorage.getItem(VOTED_KEY) || voteInFlight) return;
  voteInFlight = true;
  modalTeams.querySelectorAll('.vote-modal-team-btn').forEach(b => b.disabled = true);
  modalConfirm.disabled = true;
  modalStep.textContent = 'casting vote...';
  try {
    const ref = doc(db, 'events', EVENT_ID, 'tallies', teamId);
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const count = snap.exists() ? (snap.data().count || 0) : 0;
      tx.update(ref, { count: count + 1 });
    });
    localStorage.setItem(VOTED_KEY, teamId);
    const team = teams.find(t => t.id === teamId);
    modalStep.textContent = 'vote cast';
    modalMsg.textContent = `voted for ${team ? team.name : 'your pick'}. thanks!`;
    voteInFlight = false;
    paintCardForVoteState(teams);
    setTimeout(closeModal, 1400);
  } catch (e) {
    voteInFlight = false;
    modalStep.textContent = 'pick a team, then confirm';
    modalMsg.textContent = 'vote did not go through -- voting may have just closed.';
    modalTeams.querySelectorAll('.vote-modal-team-btn').forEach(b => b.disabled = false);
    modalConfirm.disabled = !pickedTeamId;
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
