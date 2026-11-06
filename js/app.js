/* =========================================================
   ChemFlash アプリ本体（実験室版の見た目）
   タブ: ホーム / 復習 / 書庫 / 分析 / マイ（保存・自作・同期はマイの中）
   学習データの読み書きはすべて js/store.js（ChemStore）経由。
   この画面側で保存するのは、見た目の小さな設定（UI_KEY）だけ。
   ========================================================= */
'use strict';

(() => {
  const view = document.getElementById('view');
  const S = ChemStore;
  const LAB = ChemLab;
  const APP_URL = 'https://oimo-taruto.github.io/chemflash/'; // 公開URL（QR・共有用）
  const ROUTE_URL = 'https://route-rikei.pages.dev/';
  const UI_KEY = 'chemflash_ui_v1'; // 見た目の設定だけ（学習データ chemflash_data_v1 とは別）

  /* ---------- 汎用 ---------- */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const I = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // インターリーブ: シャッフル後、同じ sub_unit が連続しないよう並べ替える
  function interleave(ids) {
    const a = shuffle(ids);
    const sub = id => (S.byId(id) || {}).sub_unit;
    for (let i = 1; i < a.length; i++) {
      if (sub(a[i]) === sub(a[i - 1])) {
        for (let j = i + 1; j < a.length; j++) {
          if (sub(a[j]) !== sub(a[i - 1])) { [a[i], a[j]] = [a[j], a[i]]; break; }
        }
      }
    }
    return a;
  }

  // 集中（ブロック）: sub_unit ごとに固める
  function blockOrder(ids) {
    const groups = {};
    for (const id of ids) {
      const su = (S.byId(id) || {}).sub_unit || '';
      (groups[su] = groups[su] || []).push(id);
    }
    return shuffle(Object.values(groups)).flatMap(g => shuffle(g));
  }

  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2200);
  }
  // ボタン付きのトースト（採点の取り消しなど）。少し長めに出す
  function toastAction(msg, label, fn, kind = '') {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${esc(msg)}</span><button type="button">${esc(label)}</button>`;
    el.className = 'show act ' + kind;
    el.querySelector('button').addEventListener('click', () => { el.className = ''; clearTimeout(toastTimer); fn(); }, { once: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 4500);
  }

  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';

  /* ---------- 見た目の設定（学習データとは別のキー） ---------- */
  const ui = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } })();
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 保存できなくても動く */ } };
  // ui に入れるもの: routeHideUntil / lastConfig（前回の演習設定）/ presets（保存した範囲）/
  //   log（日付→その日に解いた数）/ examDate（入試日）/ onboarded（最初の質問に答えたか）
  // どれも学習データ（chemflash_data_v1）には入れない。消えても学習記録は無事。

  /* ---------- 毎日の記録・連続日数（UIキーにだけ保存） ---------- */
  const DAY = 86400000;
  const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE'); // YYYY-MM-DD（端末の日付）
  function pruneLog() {
    const keys = Object.keys(ui.log).sort();
    while (keys.length > 120) delete ui.log[keys.shift()];
  }
  function initLog() {
    if (ui.log) return;
    // 初回だけ、今までの「最後に解いた日」から大まかな記録を作る（読むだけ）
    ui.log = {};
    const p = S.raw().progress || {};
    for (const k in p) {
      const l = p[k] && p[k].last;
      if (l) { const d = dayKey(l); ui.log[d] = (ui.log[d] || 0) + 1; }
    }
    pruneLog();
    saveUi();
  }
  function bumpLog(n) {
    initLog();
    const d = dayKey();
    const v = Math.max(0, (ui.log[d] || 0) + n);
    if (v) ui.log[d] = v; else delete ui.log[d];
    pruneLog();
    saveUi();
  }
  const todayCount = () => { initLog(); return ui.log[dayKey()] || 0; };
  // 連続日数。1日だけ休んでも途切れない（2日続けて休むと途切れる）。休んだ日は数えない
  function streakDays() {
    initLog();
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (!ui.log[dayKey(d.getTime())]) d.setDate(d.getDate() - 1); // 今日はまだ0でも途切れ扱いにしない
    let n = 0, gap = 0;
    for (let i = 0; i < 400; i++) {
      if (ui.log[dayKey(d.getTime())]) { n++; gap = 0; } else if (++gap >= 2) break;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /* ---------- 入試日と「今日のおまかせ」 ---------- */
  function examDaysLeft(date = ui.examDate) {
    if (!date) return null;
    const t = new Date(date + 'T00:00:00').getTime();
    const today = new Date(dayKey() + 'T00:00:00').getTime();
    return isNaN(t) ? null : Math.round((t - today) / DAY);
  }
  const activeIds = () => S.filterIds({ kind: 'all', value: '' }, 'all'); // 未習を除いた全問
  const isSeen = id => { const p = S.progressOf(id); return !!(p && p.attempts); };
  const unseenIds = () => activeIds().filter(id => !isSeen(id));
  // 1日に出す新しい問題の数。入試日があれば「入試の1週間前までに一通り」になる数（5〜40問）
  function newPerDay(unseenN = unseenIds().length, left = examDaysLeft()) {
    if (!unseenN) return 0;
    if (left == null || left <= 0) return Math.min(10, unseenN);
    return Math.min(unseenN, Math.max(5, Math.min(40, Math.ceil(unseenN / Math.max(1, left - 7)))));
  }
  const dueAt = id => { const p = S.progressOf(id); return (p && p.srs && p.srs.due) || 0; };
  const byDue = ids => ids.slice().sort((a, b) => dueAt(a) - dueAt(b)); // 期限が古い順
  const PLAN = { due: 10, wrong: 5, min: 20 };
  function planCounts() {
    const due = S.dueTodayIds();
    const dueSet = new Set(due);
    const wrongN = S.reviewWrongIds().filter(id => !dueSet.has(id)).length;
    const unseenN = unseenIds().length;
    const d = Math.min(PLAN.due, due.length), w = Math.min(PLAN.wrong, wrongN);
    const f = Math.min(unseenN, Math.max(newPerDay(unseenN), PLAN.min - d - w)); // 復習が少ない日は新しい問題で埋める
    const extra = Math.max(0, Math.min(PLAN.min - (d + w + f), activeIds().length - (d + w + f)));
    return { due: d, wrong: w, fresh: f, extra, total: d + w + f + extra };
  }
  // おまかせの出題順: 期限が来た復習（古い順）→ 間違い → 新しい問題（復習が少なければ多めに）→ それでも足りなければ おさらい
  function planOrder() {
    const due = byDue(S.dueTodayIds()).slice(0, PLAN.due);
    const used = new Set(due);
    const wrong = shuffle(S.reviewWrongIds().filter(id => !used.has(id))).slice(0, PLAN.wrong);
    wrong.forEach(id => used.add(id));
    const unseen = unseenIds();
    const fresh = interleave(unseen).slice(0, Math.max(newPerDay(unseen.length), PLAN.min - due.length - wrong.length));
    fresh.forEach(id => used.add(id));
    let order = interleave(due.concat(wrong)).concat(fresh);
    if (order.length < PLAN.min) {
      const rest = shuffle(activeIds().filter(id => !used.has(id)));
      const notGrad = rest.filter(id => { const p = S.progressOf(id); return !(p && p.srs && p.srs.graduated); });
      const grad = rest.filter(id => !notGrad.includes(id));
      order = order.concat(notGrad.concat(grad).slice(0, PLAN.min - order.length));
    }
    return order;
  }
  const dailyGoal = () => Math.min(50, Math.max(20, newPerDay() + 10));

  /* ---------- 単元（元素記号と色） ---------- */
  const UNIT_ORDER = ['化学基礎', '理論化学', '無機化学', '有機化学', '高分子化合物'];
  const UNIT_META = {
    '化学基礎': { sym: 'Ki', color: '#4cc9f0', short: '化学基礎', no: 1 },
    '理論化学': { sym: 'Ri', color: '#a78bfa', short: '理論', no: 2 },
    '無機化学': { sym: 'Mu', color: '#34d399', short: '無機', no: 3 },
    '有機化学': { sym: 'Yu', color: '#fb923c', short: '有機', no: 4 },
    '高分子化合物': { sym: 'Ko', color: '#f472b6', short: '高分子', no: 5 },
    '自作問題': { sym: 'Ji', color: '#fbbf24', short: '自作', no: 6 },
  };
  function unitMeta(u) {
    return UNIT_META[u] || { sym: String(u || '?').slice(0, 1), color: '#8d9bbb', short: String(u || ''), no: 0 };
  }
  // 単元の並び（既知の5単元 → それ以外 → 自作）
  function orderedUnits() {
    const us = S.units();
    const known = UNIT_ORDER.filter(u => us.includes(u));
    const rest = us.filter(u => !UNIT_ORDER.includes(u) && u !== '自作問題');
    return known.concat(rest, us.includes('自作問題') ? ['自作問題'] : []);
  }
  const elm = u => { const m = unitMeta(u); return `<span class="elm" style="--c:${m.color}">${esc(m.sym)}</span>`; };

  /* ---------- レベル（解いた回数の合計から計算。新しいデータは保存しない） ---------- */
  function totalExp() {
    let n = 0;
    const p = S.raw().progress || {};
    for (const k in p) n += (p[k] && p[k].attempts) || 0;
    return n;
  }
  const expAt = lv => 25 * lv * (lv - 1); // Lv1:0 Lv2:50 Lv3:150 Lv5:500 Lv10:2250
  const TITLES = [[1, '見習い化学者'], [5, '研究助手'], [10, '研究員'], [15, '主任研究員'], [20, '博士'], [30, '教授'], [40, '化学の賢者']];
  const titleOf = lv => TITLES.filter(([l]) => lv >= l).pop()[1];
  function levelInfo(exp = totalExp()) {
    let lv = 1;
    while (exp >= expAt(lv + 1)) lv++;
    const cur = expAt(lv), next = expAt(lv + 1);
    const nt = TITLES.find(([l]) => l > lv);
    return { lv, exp, next, title: titleOf(lv), nextTitle: nt ? nt[1] : null, ratio: (exp - cur) / (next - cur) };
  }

  /* ---------- 共通パーツ ---------- */
  const brandbar = () => `<header class="topbar"><div class="brand"><span class="bflask">${I('flask')}</span><span class="name">ChemFlash</span><span class="tag">高校化学 暗記ラボ</span></div><button class="iconbtn" data-act="help" aria-label="使い方">${I('help')}</button></header>`;
  function levelBar() {
    const li = levelInfo();
    return `<div class="level"><div class="lvbadge">${I('flask')}</div><div class="info"><div class="line1"><span class="lvl">Lv.${li.lv}</span><span class="ltitle">${esc(li.title)}</span><span class="exp-n">${li.exp} / ${li.next} EXP</span></div><div class="exp"><span style="width:${Math.round(li.ratio * 100)}%"></span></div></div></div>`;
  }
  const pageTitle = (t, n = '') => `<header class="topbar"><div class="ptitle"><h1>${t}</h1>${n !== '' ? `<span class="num">${n}</span>` : ''}</div></header>`;
  const backTitle = (t, to = 'me') => `<header class="topbar"><button class="back" data-go="${to}">${I('chevl')}${t}</button></header>`;
  const diffDots = d => `<span class="diffd">${[1, 2, 3].map(n => `<i class="${n <= d ? 'on' : ''}"></i>`).join('')}</span>`;
  const STATUS_ICON = { ok: 'o', vague: 'tri', ng: 'x', untouched: '', graduated: 'cap', unlearned: 'eyeoff' };
  const statusMark = key => `<span class="stv k-${key}" title="">${STATUS_ICON[key] ? I(STATUS_ICON[key]) : ''}</span>`;

  function setChrome(insession) { document.body.classList.toggle('insession', !!insession); }

  /* ---------- Route（別サイトの広告） ---------- */
  const routeLogo = `<span class="logo">Route<small>理系オンライン個別指導</small></span>`;
  function routeHome() {
    if (ui.routeHideUntil && Date.now() < ui.routeHideUntil) return '';
    return `<div class="rad radS"><a class="cover" href="${ROUTE_URL}" target="_blank" rel="noopener"><span class="rmk">R</span>
      <span class="t"><span class="logo">Route<small>理系オンライン個別指導</small><span class="pr">PR</span></span><b>わからない問題を、写真で質問・添削</b><span class="sub">数学・物理・化学｜無料体験あり</span></span>
      <span class="ex">${I('ext')}</span></a>
      <button class="cl" data-act="route-hide" aria-label="この広告をしばらく表示しない">${I('x')}</button></div>`;
  }
  const routeResult = () => `<div class="rad radM"><a class="cover" href="${ROUTE_URL}" target="_blank" rel="noopener"><div class="hd">${routeLogo}<span class="pr">PR</span></div>
    <div class="msg">${I('cam')} 解けなかった問題は、写真を送れば先生が<em>添削</em><span>数学・物理・化学／48時間以内に返信</span></div>
    <div class="ft"><span class="go">無料体験を見る${I('ext')}</span><span class="url">route-rikei.pages.dev</span></div></a></div>`;
  const routeMe = () => `<div class="rad radM"><a class="cover" href="${ROUTE_URL}" target="_blank" rel="noopener"><div class="hd">${routeLogo}<span class="pr">PR</span></div>
    <div class="catch">「わかった」を、「解ける」に<em>変える。</em></div>
    <div class="feats"><span>${I('video')}1対1の授業</span><span>${I('cam')}質問・添削</span><span>${I('gift')}無料体験2回</span></div>
    <div class="ft"><span class="go">サイトを見る${I('ext')}</span><span class="url">route-rikei.pages.dev<br>高校生・浪人生／数学・物理・化学</span></div></a></div>`;

  /* =========================================================
     問題カード（出題中 → 答え）。演習と復習で共通
     ========================================================= */
  function fhead(q) {
    const m = unitMeta(q.unit);
    const on = S.isBookmarked(q.id);
    return `<div class="fhead"><span class="eltile"><span class="z">${String(m.no || '').padStart(2, '0')}</span><span class="s">${esc(m.sym)}</span></span>
      <div class="mt"><div class="a">${esc(q.sub_unit)}</div><div class="b">${esc(q.question_type)}${diffDots(q.difficulty)}</div></div>
      <button class="starbtn ${on ? 'on' : ''}" data-act="star" aria-label="${on ? '保存を外す' : '保存する'}">${I('star')}</button></div>`;
  }
  const memoView = q => { const c = S.commentOf(q.id); return c ? `<div class="memo">${I('pencil', 's14')}<span>${esc(c)}</span></div>` : ''; };
  const memoEdit = q => `<div class="memo-edit" hidden><textarea rows="2" data-role="comment" placeholder="例: 反応式ごと暗記する／模試で出た">${esc(S.commentOf(q.id))}</textarea><button class="btn second sm" data-act="memo-save">メモを保存</button></div>`;

  /* opts: { top, qno, showUnlearned, onGrade(grade), onUnlearned() } */
  function renderCard(q, opts) {
    setChrome(true);
    const m = unitMeta(q.unit);
    view.innerHTML = `<div class="sess">${opts.top}
      <div class="labbody"><article class="glass spec qv" style="--c:${m.color}" data-qid="${esc(q.id)}">
        ${fhead(q)}
        <div class="stage">${LAB.flask({ layers: [[m.color, .5]], glow: m.color, bubbles: true })}</div>
        <div class="fq">${opts.related ? `<div class="relchip">${I('link', 's14')}さっきの問題の関連<b>#${esc(opts.related)}</b></div>` : ''}<span class="qno">Q.${String(opts.qno).padStart(2, '0')}</span><div class="qtext">${esc(q.question)}</div>${memoView(q)}</div>
        ${memoEdit(q)}
        <div class="icrow"><button data-act="memo">${I('pencil')}メモ</button>${opts.showUnlearned ? `<button data-act="unlearned" title="まだ授業で習っていない問題（出題・分析から外す）">${I('eyeoff')}まだ習ってない</button>` : ''}</div>
      </article></div>
      <div class="bench"><button class="btn primary" data-act="reveal">答えを見る</button></div></div>`;
    window.scrollTo(0, 0);
    bindCardCommon(q, opts);
    view.querySelector('[data-act="reveal"]').addEventListener('click', () => showAnswer(q, opts));
    const unl = view.querySelector('[data-act="unlearned"]');
    if (unl && opts.onUnlearned) unl.addEventListener('click', opts.onUnlearned);
  }

  function showAnswer(q, opts) {
    const card = view.querySelector('.spec');
    const tags = S.tagsOf(q.id);
    card.className = 'glass spec ansv';
    card.innerHTML = `${fhead(q)}
      <div class="gap"></div><div class="qno">Q.${String(opts.qno).padStart(2, '0')}</div><div class="fa-q" style="margin-top:4px">${esc(q.question)}</div>
      <div class="ans big" style="margin-top:12px"><div class="tagq">ANSWER</div><p>${esc(q.answer)}</p></div>
      ${tags.length ? `<div class="tags" style="margin-top:12px">${tags.map(t => `<button data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
      <div style="margin-top:10px">${memoView(q)}</div>
      ${memoEdit(q)}
      <div class="gap" style="flex:1;min-height:12px"></div>
      <div class="icrow">${tags.length ? `<button data-act="related">${I('link')}関連問題</button>` : ''}<button data-act="memo">${I('pencil')}メモ</button></div>
      <div class="deco">${LAB.flask({ layers: [['#45e3cf', .58]], glow: '#45e3cf', bubbles: true, spark: true })}</div>`;
    view.querySelector('.bench').innerHTML = `<div class="beakers">${LAB.beaker('ng', I('x'), 'わからない')}${LAB.beaker('vague', I('tri'), 'あいまい')}${LAB.beaker('ok', I('o'), '完璧')}</div>`;
    bindCardCommon(q, opts);
    view.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => opts.onGrade(b.dataset.g)));
    card.querySelectorAll('.tags [data-tag]').forEach(b => b.addEventListener('click', () => openLibraryWithTag(b.dataset.tag)));
    const rel = card.querySelector('[data-act="related"]');
    if (rel) rel.addEventListener('click', () => openLibraryWithTag(tags[0]));
  }

  function bindCardCommon(q) {
    const card = view.querySelector('.spec');
    const star = card.querySelector('[data-act="star"]');
    star.addEventListener('click', () => {
      const on = S.toggleBookmark(q.id);
      star.classList.toggle('on', on);
      toast(on ? '保存しました' : '保存を外しました', on ? 'good' : '');
    });
    const memoBtn = card.querySelector('[data-act="memo"]');
    const edit = card.querySelector('.memo-edit');
    memoBtn.addEventListener('click', () => {
      edit.hidden = !edit.hidden;
      if (!edit.hidden) edit.querySelector('textarea').focus();
    });
    card.querySelector('[data-act="memo-save"]').addEventListener('click', () => {
      const text = edit.querySelector('textarea').value;
      S.setComment(q.id, text);
      edit.hidden = true;
      const cur = card.querySelector('.memo');
      const html = memoView(q);
      if (cur) cur.outerHTML = html || '';
      else if (html) edit.insertAdjacentHTML('beforebegin', html);
      toast('メモを保存しました', 'good');
    });
  }

  const tubeBar = (counts, total, right, closeLabel = '終わる') => `<div class="tubebar"><button class="x" data-act="close" aria-label="${closeLabel}">${I('x', 's18')}</button>${LAB.tube([['ok', counts.ok], ['vague', counts.vague], ['ng', counts.ng]], total)}<span class="n">${right}</span></div>`;

  /* =========================================================
     演習（ホーム → 設定 → セッション → 結果）
     ========================================================= */
  let lastConfig = ui.lastConfig || null; // 前回の演習設定（開き直しても覚えておく）

  function validSession(s) {
    return !!(s && Array.isArray(s.order) && s.config && s.counts && typeof s.pos === 'number');
  }

  function renderPractice() {
    if (!S.questions().length) { renderEmpty(); return; }
    let s = S.raw().session;
    if (s && !validSession(s)) { S.raw().session = s = null; S.persistLocal(); } // 壊れたセッションは破棄
    if (s && s.pos < s.order.length && !s.stopped) { renderSessionCard(); return; }
    if (s && (s.stopped || s.pos >= s.order.length)) { renderSummary(); return; }
    renderHome();
  }

  /* ---------- ホーム ---------- */
  function unitAtoms() {
    return UNIT_ORDER.map(u => {
      const m = unitMeta(u);
      const mm = S.metrics(q => q.unit === u);
      return { unit: u, unitAttr: esc(u), label: esc(u), sym: m.sym, color: m.color, p: mm.total ? mm.statusBreak.ok / mm.total : null };
    });
  }

  function renderHome() {
    setChrome(false);
    const wrong = S.reviewWrongIds().length;
    const pc = planCounts();
    const done = todayCount(), goal = dailyGoal(), st = streakDays(), left = examDaysLeft();
    const cleared = done >= goal;
    const parts = [['復習', pc.due, '#45e3cf'], ['間違い', pc.wrong, '#fb923c'], ['新しい', pc.fresh, '#4cc9f0'], ['おさらい', pc.extra, '#a78bfa']].filter(p => p[1]);
    const ring = r => { const C = 2 * Math.PI * 8; return `<svg class="ring" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/><circle cx="10" cy="10" r="8" fill="none" stroke="#45e3cf" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - Math.min(1, r))).toFixed(1)}" transform="rotate(-90 10 10)"/></svg>`; };
    const active = S.questions().filter(q => !S.isUnlearned(q.id)).length;
    view.innerHTML = `${brandbar()}${levelBar()}
      <div class="today">
        <span class="tc ${st ? 'fire' : ''}">${I('flame')}<b>${st}</b>日連続</span>
        <span class="tc ${cleared ? 'clear' : ''}">${ring(done / goal)}今日 <b>${done}</b>/${goal}</span>
        <button class="tc ${left == null ? 'none' : ''}" data-act="exam">${I('cap')}${left == null ? '入試日を設定' : left > 0 ? `入試まで <b>${left}</b>日` : left === 0 ? '<b>今日</b>が入試' : '入試日を更新'}</button>
      </div>
      <div class="body">
        ${pc.total ? `<button class="quest" data-act="quest" aria-label="今日のおまかせをはじめる"><div class="fl">${LAB.flask({ layers: parts.map(([, n, c]) => [c, n / pc.total * .62]), glow: cleared ? '#45e3cf' : '#4cc9f0', bubbles: true, spark: cleared })}</div>
          <div class="qtx"><div class="tagq">${cleared ? 'TODAY · CLEAR' : 'TODAY'}</div><span class="label">${cleared ? 'もう1セット' : '今日のおまかせ'}</span><div class="num">${pc.total}<small>問</small></div>
            <div class="mix">${parts.map(([t, n, c]) => `<span style="--c:${c}"><i></i>${t} ${n}</span>`).join('')}</div></div>
          <span class="play">${I('play')}</span></button>`
        : `<button class="quest" data-act="setup"><div class="fl">${LAB.flask({})}</div><div class="qtx"><div class="tagq">QUEST</div><span class="label">出せる問題がありません</span><div class="mix"><span>範囲を選んで演習</span></div></div><span class="play">${I('play')}</span></button>`}
        <div class="card mol"><div class="head"><span class="label">単元</span><button class="r" data-go="stats"><b>${S.graduatedCount()}</b>/ ${active} 定着${I('chev', 's14')}</button></div>${LAB.molecule(unitAtoms(), null)}</div>
        <div class="quick">
          <button class="u1" data-act="setup"><span class="ib">${I('tube')}</span>演習</button>
          <button class="u4" data-act="wrong"><span class="ib">${I('target')}${wrong ? `<i class="qn">${wrong > 99 ? '99+' : wrong}</i>` : ''}</span>間違い復習</button>
          <button class="u2" data-act="timed"><span class="ib">${I('timer')}</span>15分</button>
          <button class="u5" data-go="saved"><span class="ib">${I('star')}</span>保存</button>
        </div>
        ${routeHome()}
      </div>`;
    const qb = view.querySelector('[data-act="quest"]');
    if (qb) qb.addEventListener('click', () => startSession({ size: 'all', order: 'mix', scope: { kind: 'all', value: '' }, target: 'auto' }));
    view.querySelectorAll('[data-act="setup"]').forEach(b => b.addEventListener('click', () => openSetup()));
    view.querySelector('[data-act="wrong"]').addEventListener('click', () => {
      if (!wrong) { toast('間違い復習はありません'); return; }
      switchTab('review'); startReview('wrong');
    });
    view.querySelector('[data-act="timed"]').addEventListener('click', () =>
      startSession({ size: 'time', order: 'mix', scope: { kind: 'all', value: '' }, target: 'new' }));
    bindAtoms(u => { statsState.expandedUnit = u; switchTab('stats'); });
  }

  /* ---------- 入試日（下から出るシート） ---------- */
  function openExam() {
    closeSetup();
    const unseenN = unseenIds().length;
    const preview = v => {
      const left = examDaysLeft(v);
      if (!v || left == null) return `入試日がないときは、新しい問題を1日 <b>${newPerDay(unseenN, null)}</b>問 出します`;
      if (left <= 0) return '過ぎた日付です。次の入試日を入れてください';
      return `入試まで <b>${left}</b>日 → 新しい問題を1日 <b>${newPerDay(unseenN, left)}</b>問（まだ解いていない問題 ${unseenN}問）`;
    };
    sheetRoot.innerHTML = `<div class="dim" data-act="close"></div>
      <div class="sheet" role="dialog" aria-label="入試日"><div class="handle"></div>
        <div class="sh"><h2>入試日</h2><button class="iconbtn" data-act="close" aria-label="閉じる">${I('x', 's18')}</button></div>
        <p class="snote">入れておくと、「今日のおまかせ」に出す新しい問題の数を、<b>入試の1週間前までに一通り終わる</b>ように自動で決めます（1日5〜40問）。</p>
        <input type="date" id="exam-date" class="valsel datein" value="${esc(ui.examDate || '')}" min="${dayKey()}">
        <div class="pool" id="exam-prev">${preview(ui.examDate)}</div>
        <div class="btnrow">${ui.examDate ? `<button class="btn second" data-act="exam-clear">消す</button>` : ''}<button class="btn primary" data-act="exam-save">保存</button></div>
      </div>`;
    const input = document.getElementById('exam-date');
    input.addEventListener('input', () => { document.getElementById('exam-prev').innerHTML = preview(input.value); });
    sheetRoot.onclick = e => {
      const b = e.target.closest('button, .dim');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'close') closeSetup();
      else if (a === 'exam-clear') { delete ui.examDate; saveUi(); closeSetup(); rerenderHere(); toast('入試日を消しました'); }
      else if (a === 'exam-save') {
        if (input.value && (examDaysLeft(input.value) || 0) <= 0) { toast('今日より後の日付を選んでください', 'bad'); return; }
        if (input.value) ui.examDate = input.value; else delete ui.examDate;
        saveUi(); closeSetup(); rerenderHere(); toast(input.value ? '入試日を保存しました' : '入試日を消しました', 'good');
      }
    };
  }
  const rerenderHere = () => { if (currentTab === 'home' || currentTab === 'me') renderers[currentTab](); };

  /* ---------- 最初に開いたときだけ「どこまで習った？」 ----------
     今まで使っている人（解いた記録・未習の設定・途中のセッションがある人）には聞かず、設定も変えない。 */
  const ONBOARD = [
    ['化学基礎だけ', '高1・化学基礎を勉強中', ['化学基礎']],
    ['理論化学まで', '化学の前半（状態・反応）', ['化学基礎', '理論化学']],
    ['無機化学まで', '有機はまだ', ['化学基礎', '理論化学', '無機化学']],
    ['全部習った', '有機・高分子まで', UNIT_ORDER.slice()],
  ];
  function maybeOnboard() {
    if (ui.onboarded) return;
    const d = S.raw();
    if (totalExp() > 0 || Object.keys(d.unlearned || {}).length || d.session) { ui.onboarded = 1; saveUi(); return; }
    sheetRoot.innerHTML = `<div class="dim"></div>
      <div class="sheet" role="dialog" aria-label="どこまで習った？"><div class="handle"></div>
        <div class="sh"><h2>どこまで習った？</h2></div>
        <p class="snote">まだ授業で習っていない単元は、出題から外しておきます。あとから <b>マイ › 学習範囲</b> でいつでも変えられます。</p>
        <div class="onbl">${ONBOARD.map(([t, s, units], i) => `<button data-onb="${i}"><span class="els">${UNIT_ORDER.map(u => { const m = unitMeta(u); return `<span class="${units.includes(u) ? 'on' : ''}" style="--c:${m.color}">${m.sym}</span>`; }).join('')}</span><span class="tx"><b>${t}</b><small>${s}</small></span>${I('chev', 's16')}</button>`).join('')}</div>
        <button class="btn second sm" data-act="onb-later">あとで決める（全部出す）</button>
      </div>`;
    const finish = () => { ui.onboarded = 1; saveUi(); sheetRoot.innerHTML = ''; sheetRoot.onclick = null; };
    sheetRoot.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'onb-later') { finish(); return; }
      if (b.dataset.onb == null) return;
      const learned = ONBOARD[+b.dataset.onb][2];
      finish();
      // 最新の問題リストが届いてから外す（届いた問題も漏れなく）
      S.ready.then(() => {
        UNIT_ORDER.filter(u => !learned.includes(u)).forEach(u => S.setUnlearnedScope(u, '', true));
        updateBadges();
        if (!document.body.classList.contains('insession')) renderers[currentTab]();
        toast(learned.length === UNIT_ORDER.length ? '全部の単元から出します' : `${learned.map(u => unitMeta(u).short).join('・')}から出します`, 'good');
      });
    };
  }

  function bindAtoms(fn) {
    view.querySelectorAll('.atom-hit').forEach(g => {
      g.addEventListener('click', () => fn(g.dataset.unit));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(g.dataset.unit); } });
    });
  }

  /* ---------- 演習の設定（下から出るシート） ---------- */
  let setup = null;
  const sheetRoot = document.getElementById('sheet-root');

  function openSetup() {
    const c = lastConfig || { size: '20', order: 'mix', scope: { kind: 'all', value: '' }, target: 'new' };
    const sc = c.scope || { kind: 'all' };
    const key = q => q.unit + '\t' + q.sub_unit;
    let picks = [];
    if (sc.kind === 'pick') picks = (sc.picks || []).slice();
    else if (sc.kind === 'unit') picks = S.subUnitsOfUnit(sc.value).map(su => sc.value + '\t' + su);
    else if (sc.kind === 'sub') picks = [...new Set(S.questions().filter(q => q.sub_unit === sc.value).map(key))];
    setup = {
      size: c.size || '20', order: c.order || 'mix',
      target: c.target === 'all' ? 'all' : 'new', // 旧「苦手」は間違い復習にまとめたので「新しい問題から」に
      picks, tag: sc.kind === 'tag' ? sc.value : (sc.tag || ''),
      diffs: sc.kind === 'diff' ? [String(sc.value)] : (sc.diffs || []).map(String),
      fine: false, naming: false,
    };
    // 単元の一部だけ選んでいたら、分野の一覧を開いておく
    setup.fine = unitGroups().some(g => { const n = g.subs.filter(x => setup.picks.includes(x.key)).length; return n && n < g.subs.length; });
    renderSetup();
  }
  function closeSetup() { sheetRoot.innerHTML = ''; sheetRoot.onclick = null; setup = null; }

  // 単元ごとの分野一覧（問題数は未習を除いた数）
  function unitGroups() {
    const cnt = {};
    for (const q of S.questions()) if (!S.isUnlearned(q.id)) cnt[q.unit + '\t' + q.sub_unit] = (cnt[q.unit + '\t' + q.sub_unit] || 0) + 1;
    return orderedUnits().map(u => ({
      unit: u,
      subs: S.subUnitsOfUnit(u).map(su => ({ sub: su, key: u + '\t' + su, n: cnt[u + '\t' + su] || 0 })),
    }));
  }
  function setupScope() {
    if (!setup.picks.length && !setup.tag && !setup.diffs.length) return { kind: 'all', value: '' };
    return { kind: 'pick', picks: setup.picks.slice(), tag: setup.tag, diffs: setup.diffs.slice() };
  }
  function scopeLabelOf(sc, groups = unitGroups()) {
    if (!sc || sc.kind === 'all') return '';
    if (sc.kind === 'unit') return unitMeta(sc.value).short;
    if (sc.kind === 'sub' || sc.kind === 'tag' || sc.kind === 'diff') return sc.kind === 'tag' ? '#' + sc.value : sc.kind === 'diff' ? '難易度' + sc.value : sc.value;
    const set = new Set(sc.picks || []);
    const parts = [];
    let loose = [];
    for (const g of groups) {
      const on = g.subs.filter(x => set.has(x.key));
      if (!on.length) continue;
      if (on.length === g.subs.length) parts.push(unitMeta(g.unit).short);
      else loose = loose.concat(on.map(x => x.sub));
    }
    if (loose.length === 1) parts.push(loose[0]); else if (loose.length) parts.push(loose.length + '分野');
    let s = parts.length > 2 ? parts.slice(0, 2).join('・') + 'ほか' : parts.join('・');
    if (sc.tag) s += (s ? '・' : '') + '#' + sc.tag;
    if (sc.diffs && sc.diffs.length) s += (s ? '・' : '') + '難' + sc.diffs.slice().sort().join('');
    return s;
  }

  function renderSetup() {
    const prevScroll = sheetRoot.querySelector('.sheet') ? sheetRoot.querySelector('.sheet').scrollTop : 0;
    const sizes = [['10', .25], ['20', .5], ['30', .75], ['all', 1]];
    const groups = unitGroups();
    const set = new Set(setup.picks);
    const unitState = g => { const n = g.subs.filter(x => set.has(x.key)).length; return n === 0 ? '' : n === g.subs.length ? 'on' : 'part'; };
    const sc = setupScope();
    const pool = scopeIds(sc, 'all');
    const fresh = pool.filter(id => !isSeen(id)).length;
    const label = scopeLabelOf(sc, groups);
    const sizeLabel = setup.size === 'time' ? '15分' : setup.size === 'all' ? '全部' : setup.size + '問';
    const tags = S.allTags().sort((a, b) => a.localeCompare(b, 'ja'));
    const presets = ui.presets || [];
    const canSave = sc.kind !== 'all';
    sheetRoot.innerHTML = `<div class="dim" data-act="close"></div>
      <div class="sheet" role="dialog" aria-label="演習の設定"><div class="handle"></div>
        <div class="sh"><h2>演習</h2><button class="iconbtn" data-act="close" aria-label="閉じる">${I('x', 's18')}</button></div>
        <div><div class="label" style="margin-bottom:7px">出題数</div><div class="cnt">${sizes.map(([v, f]) => {
          const on = setup.size === v;
          return `<button class="${on ? 'on' : ''}" data-size="${v}">${LAB.vial([[on ? '#4cc9f0' : 'rgba(76,201,240,.55)', f]], on ? '#4cc9f0' : null)}${v === 'all' ? '<small>全部</small>' : v}</button>`;
        }).join('')}<button class="${setup.size === 'time' ? 'on' : ''}" data-size="time"><span class="tm">${I('timer')}</span><small>15分</small></button></div></div>
        <div>
          <div class="lrow"><span class="label">範囲<small>いくつでも選べます</small></span>${canSave && !setup.naming ? `<button class="lnk" data-act="psave">${I('star', 's14')}この範囲を保存</button>` : ''}</div>
          ${setup.naming ? `<div class="pname"><input id="preset-name" maxlength="16" value="${esc(label)}" placeholder="例: 2学期中間"><button class="btn primary sm" data-act="pok">保存</button><button class="btn second sm" data-act="pcancel">やめる</button></div>` : ''}
          ${presets.length ? `<div class="presets">${presets.map((p, i) => `<span class="pre"><button data-preset="${i}">${I('star', 's14')}${esc(p.name)}</button><button class="del" data-pdel="${i}" aria-label="${esc(p.name)}を消す">${I('x', 's14')}</button></span>`).join('')}</div>` : ''}
          <div class="eltiles"><button class="${set.size ? '' : 'on'}" style="--c:#c9d3ea" data-act="pick-all">全<small>すべて</small></button>${groups.map(g => {
            const m = unitMeta(g.unit), st = unitState(g);
            return `<button class="${st}" style="--c:${m.color}" data-unit="${esc(g.unit)}">${esc(m.sym)}<small>${esc(m.short)}</small>${st === 'part' ? '<i class="pdot"></i>' : ''}</button>`;
          }).join('')}</div>
          <button class="finetg ${setup.fine ? 'open' : ''}" data-act="fine">${I('layers', 's14')}分野で選ぶ${I('chevd', 's14')}</button>
          ${setup.fine ? `<div class="fine">${groups.map(g => {
            const m = unitMeta(g.unit);
            return `<div class="fg" style="--c:${m.color}"><div class="fh">${elm(g.unit)}<b>${esc(g.unit)}</b></div><div class="chips">${g.subs.map(x =>
              `<button class="chip ${set.has(x.key) ? 'on' : ''} ${x.n ? '' : 'none'}" data-key="${esc(x.key)}">${esc(x.sub)}<small>${x.n || '未習'}</small></button>`).join('')}</div></div>`;
          }).join('')}</div>` : ''}
          <div class="filt">
            <div class="dp"><span class="label">難易度</span>${['1', '2', '3'].map(d => `<button class="${setup.diffs.includes(d) ? 'on' : ''}" data-diff="${d}" aria-label="難易度${d}">${diffDots(+d)}</button>`).join('')}</div>
            <select class="pill ${setup.tag ? 'on' : ''}" id="setup-tag" aria-label="キーワード"><option value="">#キーワード</option>${tags.map(t => `<option value="${esc(t)}" ${t === setup.tag ? 'selected' : ''}>#${esc(t)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="seg2">
          <div><div class="label" style="margin-bottom:7px">並べ方</div><div class="seg"><button class="${setup.order === 'mix' ? 'on' : ''}" data-order="mix">${I('shuffle', 's14')}ミックス</button><button class="${setup.order === 'block' ? 'on' : ''}" data-order="block">${I('layers', 's14')}分野ごと</button></div></div>
          <div><div class="label" style="margin-bottom:7px">出す問題</div><div class="seg"><button class="${setup.target === 'new' ? 'on' : ''}" data-target="new">新しい問題から</button><button class="${setup.target === 'all' ? 'on' : ''}" data-target="all">全部</button></div></div>
        </div>
        <div class="pool">${pool.length ? `対象 <b>${pool.length}</b>問（まだ解いていない問題 ${fresh}問）` : '<span class="warn">この条件に出せる問題がありません</span>'}</div>
        <button class="btn primary" data-act="start" ${pool.length ? '' : 'disabled'}>${I('play', 'fillc')}${esc(label ? label + 'で' : '')} ${sizeLabel} はじめる</button>
      </div>`;
    const sheet = sheetRoot.querySelector('.sheet');
    sheet.scrollTop = prevScroll;
    const nameInput = document.getElementById('preset-name');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
    document.getElementById('setup-tag').addEventListener('change', e => { setup.tag = e.target.value; renderSetup(); });
    sheetRoot.onclick = e => {
      const b = e.target.closest('button, .dim');
      if (!b || !setup) return;
      const d = b.dataset;
      if (d.act === 'close') { closeSetup(); return; }
      if (d.size) setup.size = d.size;
      else if (d.act === 'pick-all') setup.picks = [];
      else if (d.unit) {
        const g = groups.find(x => x.unit === d.unit);
        const keys = g.subs.map(x => x.key);
        setup.picks = unitState(g) === 'on' ? setup.picks.filter(k => !keys.includes(k)) : [...new Set(setup.picks.concat(keys))];
      } else if (d.key) setup.picks = set.has(d.key) ? setup.picks.filter(k => k !== d.key) : setup.picks.concat(d.key);
      else if (d.act === 'fine') setup.fine = !setup.fine;
      else if (d.diff) setup.diffs = setup.diffs.includes(d.diff) ? setup.diffs.filter(x => x !== d.diff) : setup.diffs.concat(d.diff);
      else if (d.order) setup.order = d.order;
      else if (d.target) setup.target = d.target;
      else if (d.act === 'psave') setup.naming = true;
      else if (d.act === 'pcancel') setup.naming = false;
      else if (d.act === 'pok') {
        const name = (document.getElementById('preset-name').value || '').trim() || label || '保存した範囲';
        ui.presets = [{ name, picks: setup.picks.slice(), tag: setup.tag, diffs: setup.diffs.slice() }].concat((ui.presets || []).filter(p => p.name !== name)).slice(0, 8);
        saveUi();
        setup.naming = false;
        toast('範囲を保存しました', 'good');
      } else if (d.preset) {
        const p = presets[+d.preset];
        if (p) { setup.picks = (p.picks || []).slice(); setup.tag = p.tag || ''; setup.diffs = (p.diffs || []).slice(); }
      } else if (d.pdel) {
        const p = presets[+d.pdel];
        if (p && confirm(`保存した範囲「${p.name}」を消しますか？（学習記録は消えません）`)) { ui.presets = presets.filter((_, i) => i !== +d.pdel); saveUi(); }
      } else if (d.act === 'start') {
        if (startSession({ size: setup.size, order: setup.order, scope: setupScope(), target: setup.target })) closeSetup();
        return;
      } else return;
      renderSetup();
    };
  }

  // 範囲で絞る。kind:'pick' は「単元＋タブ＋分野」の組の集合＋キーワード＋難易度（複数可）。それ以外は今までの形
  function scopeIds(scope, target) {
    if (!scope || scope.kind !== 'pick') return S.filterIds(scope, target);
    const picks = new Set(scope.picks || []);
    const diffs = (scope.diffs || []).map(String);
    return S.filterIds({ kind: 'all', value: '' }, target).filter(id => {
      const q = S.byId(id);
      if (!q) return false;
      if (picks.size && !picks.has(q.unit + '\t' + q.sub_unit)) return false;
      if (scope.tag && !(' ' + q.tags + ' ').includes(' ' + scope.tag + ' ')) return false;
      if (diffs.length && !diffs.includes(String(q.difficulty))) return false;
      return true;
    });
  }

  function buildOrder(config) {
    if (config.target === 'auto') return planOrder(); // 今日のおまかせ
    let ids = scopeIds(config.scope, config.target);
    ids = config.order === 'block' ? blockOrder(ids) : interleave(ids);
    if (config.target === 'new') {
      const seen = id => { const p = S.progressOf(id); return p && p.attempts; };
      ids = ids.filter(id => !seen(id)).concat(ids.filter(seen));
    }
    if (config.size !== 'all' && config.size !== 'time') ids = ids.slice(0, parseInt(config.size, 10));
    return ids;
  }

  function startSession(config) {
    const order = buildOrder(config);
    if (!order.length) {
      toast('この条件に出せる問題がありません', 'bad');
      return false;
    }
    undoSnap = null;
    resetRelated();
    if (config.target !== 'auto') { lastConfig = config; ui.lastConfig = config; saveUi(); }
    S.raw().session = {
      config, order, pos: 0, stopped: false,
      counts: { ok: 0, vague: 0, ng: 0, unlearned: 0 },
      startedAt: Date.now(),
      endsAt: config.size === 'time' ? Date.now() + 15 * 60000 : null,
    };
    S.persistLocal();
    if (currentTab !== 'home') markTab('home');
    currentTab = 'home';
    renderSessionCard();
    return true;
  }

  function renderSessionCard() {
    const s = S.raw().session;
    if (s.endsAt && Date.now() > s.endsAt) { s.stopped = true; S.persistLocal(); renderSummary(); return; }

    const q = S.byId(s.order[s.pos]);
    if (!q) { s.pos++; S.persistLocal(); renderPractice(); return; }

    const timeLeft = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 60000)) : null;
    const right = s.endsAt ? `残り${timeLeft}<small>分</small>` : `${s.pos + 1}<small> / ${s.order.length}</small>`;
    const total = s.endsAt ? Math.max(s.order.length, 1) : s.order.length;
    renderCard(q, {
      top: tubeBar(s.counts, s.endsAt ? Math.max(s.pos + 10, 20) : total, right, 'ストップ'),
      qno: s.pos + 1,
      showUnlearned: true,
      related: relNote.get(q.id),
      onGrade: grade => {
        const snap = snapAnswer(q.id, 'home');
        S.recordAnswer(q.id, grade);
        bumpLog(1);
        s.counts[grade]++;
        s.pos++;
        if (grade === 'ng') {
          const r = pickRelated(q);
          if (r) { // 次の1問に差し込む（あとで出る予定だったら前に移すだけ）
            const at = s.order.indexOf(r.id, s.pos);
            if (at >= 0) s.order.splice(at, 1);
            s.order.splice(s.pos, 0, r.id);
            noteRelated(r);
          }
        }
        S.persistLocal();
        updateBadges();
        offerUndo(snap, grade);
        renderPractice();
      },
      onUnlearned: () => {
        S.setUnlearned(q.id, true);
        s.counts.unlearned++;
        s.order.splice(s.pos, 1); // このセッションからも外す
        S.persistLocal();
        toast('未習にしました（出題から除外）');
        renderPractice();
      },
    });
    view.querySelector('[data-act="close"]').addEventListener('click', () => {
      s.stopped = true; S.persistLocal(); renderSummary();
    });
  }

  function renderSummary() {
    const s = S.raw().session;
    const c = s.counts;
    const done = c.ok + c.vague + c.ng;
    const full = !s.stopped && s.config.size === 'all' && s.config.scope.kind === 'all' && s.config.target !== 'weak' && s.config.target !== 'auto';
    if (full && done > 0) { S.raw().totalCycles = (S.raw().totalCycles || 0) + 1; }
    S.raw().session = null;
    S.persistLocal();

    setChrome(true);
    const li = levelInfo();
    const rate = done ? c.ok / done : 0;
    const miss = c.vague + c.ng;
    view.innerHTML = `<div class="sess">
      <div class="resbody">
        <div class="clear"><div class="tagq">${done ? 'QUEST CLEAR' : 'STOP'}</div><h2>おつかれさま</h2></div>
        <div class="flaskres">${LAB.flask(done ? { layers: [['#fb923c', c.ng / done * .9], ['#fbbf24', c.vague / done * .9], ['#34d399', c.ok / done * .9]], glow: '#34d399', bubbles: true, spark: rate >= .6 } : {})}
          <div class="pct"><span class="label">完璧</span><span class="num">${done ? Math.round(rate * 100) : 0}<small>%</small></span></div>
          <div class="legend3"><span style="color:var(--green)">${I('o')}${c.ok}</span><span style="color:var(--yellow)">${I('tri')}${c.vague}</span><span style="color:var(--orange)">${I('x')}${c.ng}</span></div></div>
        <div class="card gain"><span class="plus">+${done}</span><div class="info"><div class="line1"><span class="lvl">Lv.${li.lv}</span><span class="ltitle">${esc(li.title)}</span><span class="exp-n">${li.exp} / ${li.next} EXP</span></div><div class="exp"><span style="width:${Math.round(li.ratio * 100)}%"></span></div></div></div>
        ${miss ? routeResult() : ''}
      </div>
      <div class="bench"><div class="stack">
        <button class="btn primary" id="again-btn">${I('rotate')}もう一回（同じ条件）</button>
        <div class="btnrow">${miss ? `<button class="btn second" id="to-review">${I('target')}間違いを復習</button>` : `<button class="btn second" id="setup-btn">${I('tube')}設定を変える</button>`}<button class="btn second" id="home-btn">${I('house')}ホーム</button></div>
      </div></div></div>`;
    window.scrollTo(0, 0);
    document.getElementById('again-btn').addEventListener('click', () => startSession(s.config));
    document.getElementById('home-btn').addEventListener('click', () => switchTab('home'));
    const sb = document.getElementById('setup-btn');
    if (sb) sb.addEventListener('click', () => { lastConfig = s.config; switchTab('home'); openSetup(); });
    const tr = document.getElementById('to-review');
    if (tr) tr.addEventListener('click', () => { switchTab('review'); startReview('wrong'); });
  }

  /* =========================================================
     復習（今日の復習 / 間違い復習）
     ========================================================= */
  const DUE_CAP = 20;
  const reviewState = { mode: 'due', sub: '', type: '', pool: null, active: false, counts: { ok: 0, vague: 0, ng: 0 }, done: 0 };

  function buildReviewPool() {
    // 今日の復習は期限が古い順に20問（問題の並び順で先頭の単元ばかりにならないように）→ 分野が続かないよう混ぜる
    reviewState.pool = reviewState.mode === 'due'
      ? interleave(byDue(S.dueTodayIds(reviewState.sub, reviewState.type)).slice(0, DUE_CAP))
      : shuffle(S.reviewWrongIds(reviewState.sub, reviewState.type));
  }

  /* ---------- ×のあとに関連問題を1問（AI StLike の「つまずきフォロー」の考え方） ----------
     習っている範囲（未習にしていない問題）だけから、キーワードが近い問題を選ぶ。
     「色」「製法」のようにたくさんの問題に付いているキーワードは軽く、珍しいキーワードほど重く数える。
     関連問題からさらに関連問題は出さない。1回の演習・復習で5問まで。 */
  const relNote = new Map(); // 関連問題として差し込んだid → 共通のキーワード（画面の印用。保存しない）
  let relCount = 0;
  const REL_MAX = 5, REL_MIN_SCORE = 3, TAG_COMMON = 25;
  let tagFreq = null;
  function resetRelated() { relNote.clear(); relCount = 0; }
  function noteRelated(r) { relNote.set(r.id, r.tag); relCount++; }
  function pickRelated(q) {
    if (relNote.has(q.id) || relCount >= REL_MAX) return null;
    const tags = S.tagsOf(q.id);
    if (!tags.length) return null;
    const qs = S.questions();
    if (!tagFreq) { tagFreq = {}; for (const x of qs) for (const t of S.tagsOf(x.id)) tagFreq[t] = (tagFreq[t] || 0) + 1; }
    const now = Date.now();
    let best = null;
    for (const x of qs) {
      if (x.id === q.id || S.isUnlearned(x.id)) continue; // 習っている範囲だけ
      const p = S.progressOf(x.id);
      if (p && p.last && now - p.last < 15 * 60000) continue; // さっき解いたばかりの問題は出さない
      const shared = S.tagsOf(x.id).filter(t => tags.includes(t));
      if (!shared.length) continue;
      let score = shared.reduce((a, t) => a + (tagFreq[t] >= TAG_COMMON ? 1 : Math.log(qs.length / tagFreq[t])), 0) + (x.sub_unit === q.sub_unit ? 1.5 : 0);
      if (score < REL_MIN_SCORE) continue;
      score += (!p || p.status !== 'ok' ? .8 : 0) - (p && p.srs && p.srs.graduated ? 1 : 0) + Math.random() * .3;
      if (!best || score > best.score) best = { id: x.id, score, tag: shared.slice().sort((a, b) => tagFreq[a] - tagFreq[b])[0] };
    }
    return best;
  }

  /* ---------- 採点の取り消し（押し間違い用）。直前の1問だけ、採点前の状態に戻す ---------- */
  let undoSnap = null;
  const clone = v => v == null ? null : JSON.parse(JSON.stringify(v));
  function snapAnswer(id, tab) {
    const d = S.raw();
    return {
      id, tab, day: dayKey(),
      prog: clone(d.progress[id]), unl: !!d.unlearned[id],
      session: clone(d.session), cycles: d.totalCycles || 0,
      review: { pool: reviewState.pool ? reviewState.pool.slice() : null, counts: { ...reviewState.counts }, done: reviewState.done, active: reviewState.active },
    };
  }
  const GRADE_WORD = { ok: '完璧', vague: 'あいまい', ng: 'わからない' };
  function offerUndo(snap, grade) {
    undoSnap = snap;
    toastAction(`「${GRADE_WORD[grade]}」で記録`, '取り消す', doUndo, grade === 'ok' ? 'good' : '');
  }
  function doUndo() {
    const u = undoSnap;
    undoSnap = null;
    if (!u) return;
    const d = S.raw();
    if (u.prog) d.progress[u.id] = u.prog; else delete d.progress[u.id];
    if (u.unl) d.unlearned[u.id] = true;
    d.session = u.session;
    d.totalCycles = u.cycles;
    S.persist();
    if (u.day === dayKey()) bumpLog(-1);
    Object.assign(reviewState, u.review);
    updateBadges();
    if (u.tab === 'review') { currentTab = 'review'; markTab('review'); closeSetup(); renderReview(); }
    else switchTab('home');
    toast('取り消しました');
  }

  function startReview(mode) {
    undoSnap = null;
    resetRelated();
    reviewState.mode = mode;
    buildReviewPool();
    if (!reviewState.pool.length) { toast('この条件の復習はありません'); renderReview(); return; }
    reviewState.active = true;
    reviewState.counts = { ok: 0, vague: 0, ng: 0 };
    reviewState.done = 0;
    renderReview();
  }

  function renderReview() {
    if (!S.questions().length) { renderEmpty(); return; }
    if (reviewState.active) { renderReviewCard(); return; }
    setChrome(false);
    const dueIds = S.dueTodayIds(reviewState.sub, reviewState.type);
    const wrongIds = S.reviewWrongIds(reviewState.sub, reviewState.type);
    const subOptions = S.subUnits().map(s => `<option value="${esc(s)}" ${reviewState.sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const typeOptions = S.TYPES.map(t => `<option value="${esc(t)}" ${reviewState.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const rackIds = dueIds.length ? dueIds : wrongIds;
    const byUnit = {};
    for (const id of rackIds) { const q = S.byId(id); if (q) byUnit[q.unit] = (byUnit[q.unit] || 0) + 1; }
    const rackUnits = orderedUnits().filter(u => UNIT_ORDER.includes(u) || byUnit[u]);
    const maxN = Math.max(1, ...Object.values(byUnit));
    view.innerHTML = `${pageTitle('復習')}
      <div class="body">
        <button class="glass rvc" data-mode="due"><div class="fl">${LAB.flask({ layers: [['#45e3cf', dueIds.length ? .55 : .08]], glow: dueIds.length ? '#45e3cf' : null, bubbles: !!dueIds.length })}</div>
          <div class="tx"><div class="tagq">DAILY QUEST</div><span class="label" style="margin-top:2px;color:#9aa8c7">今日の復習</span><div class="num">${dueIds.length}<small>問</small></div><div class="sub">${dueIds.length > DUE_CAP ? `1回${DUE_CAP}問ずつ` : '完璧にすると間隔がのびる'}</div></div>
          <span class="play sm">${I('play')}</span></button>
        <button class="glass rvc or" data-mode="wrong"><div class="fl">${LAB.flask({ layers: [['#fb923c', wrongIds.length ? Math.min(.55, .15 + wrongIds.length / 60) : .06]], glow: wrongIds.length ? '#fb923c' : null })}</div>
          <div class="tx"><span class="label">間違い復習</span><div class="num">${wrongIds.length}<small>問</small></div><div class="sub">○になるまで出る</div></div>
          <span class="play sm or">${I('play')}</span></button>
        <div class="pills">
          <select class="pill ${reviewState.sub ? 'on' : ''}" id="rv-sub" aria-label="分野"><option value="">すべての分野</option>${subOptions}</select>
          <select class="pill ${reviewState.type ? 'on' : ''}" id="rv-type" aria-label="タイプ"><option value="">すべてのタイプ</option>${typeOptions}</select>
        </div>
        ${rackIds.length ? `<div class="card rack"><span class="label">${dueIds.length ? '今日の復習' : '間違い復習'}の内訳</span>
          <div class="rk">${rackUnits.map(u => {
            const m = unitMeta(u), n = byUnit[u] || 0;
            return `<div class="v"><span class="n" style="color:${n ? m.color : 'var(--dim2)'}">${n}</span>${LAB.vial([[m.color, n / maxN * .9]], n ? m.color : null)}${elm(u)}</div>`;
          }).join('')}</div></div>`
        : `<div class="card empty"><h2>復習はありません</h2><p>演習で「あいまい」「わからない」を選んだ問題や、<br>そろそろ忘れそうな問題がここにたまります。</p></div>`}
      </div>`;
    view.querySelectorAll('.rvc').forEach(b => b.addEventListener('click', () => startReview(b.dataset.mode)));
    document.getElementById('rv-sub').addEventListener('change', e => { reviewState.sub = e.target.value; renderReview(); });
    document.getElementById('rv-type').addEventListener('change', e => { reviewState.type = e.target.value; renderReview(); });
  }

  function renderReviewCard() {
    const st = reviewState;
    if (!st.pool.length) { renderReviewDone(); return; }
    const q = S.byId(st.pool[0]);
    if (!q) { st.pool.shift(); renderReviewCard(); return; }
    const total = st.done + st.pool.length;
    renderCard(q, {
      top: tubeBar(st.counts, total, `残り ${st.pool.length}`, '復習をやめる'),
      qno: st.done + 1,
      showUnlearned: false,
      related: relNote.get(q.id),
      onGrade: grade => {
        const snap = snapAnswer(q.id, 'review');
        S.recordAnswer(q.id, grade);
        bumpLog(1);
        st.pool.shift();
        st.counts[grade]++;
        st.done++;
        if (st.mode === 'wrong' && grade !== 'ok') st.pool.push(q.id);
        if (grade === 'ng') {
          const r = pickRelated(q);
          if (r) { const at = st.pool.indexOf(r.id); if (at >= 0) st.pool.splice(at, 1); st.pool.unshift(r.id); noteRelated(r); }
        }
        updateBadges();
        offerUndo(snap, grade);
        renderReviewCard();
      },
    });
    view.querySelector('[data-act="close"]').addEventListener('click', () => { st.active = false; renderReview(); });
  }

  function renderReviewDone() {
    const st = reviewState;
    const remaining = st.mode === 'due' ? S.dueTodayIds(st.sub, st.type).length : 0;
    const c = st.counts;
    const done = c.ok + c.vague + c.ng;
    setChrome(true);
    view.innerHTML = `<div class="sess"><div class="resbody">
        <div class="clear"><div class="tagq">QUEST CLEAR</div><h2>${remaining ? `${DUE_CAP}問おつかれさま` : 'おつかれさま'}</h2></div>
        <div class="flaskres">${LAB.flask(done ? { layers: [['#fb923c', c.ng / done * .9], ['#fbbf24', c.vague / done * .9], ['#34d399', c.ok / done * .9]], glow: '#34d399', bubbles: true, spark: true } : {})}
          <div class="legend3"><span style="color:var(--green)">${I('o')}${c.ok}</span><span style="color:var(--yellow)">${I('tri')}${c.vague}</span><span style="color:var(--orange)">${I('x')}${c.ng}</span></div></div>
        <p class="hint">${remaining ? `今日の復習はまだ ${remaining} 問あります` : (st.mode === 'due' ? '今日の復習はおしまい。また期限が来たら出てきます' : '間違い復習はすべて完璧になりました')}</p>
      </div>
      <div class="bench"><div class="stack">
        ${remaining ? `<button class="btn primary" id="rv-continue">${I('rotate')}続けて復習する</button>` : ''}
        <div class="btnrow"><button class="btn second" id="rv-top">${I('rotate')}復習</button><button class="btn second" id="rv-home">${I('house')}ホーム</button></div>
      </div></div></div>`;
    window.scrollTo(0, 0);
    const cont = document.getElementById('rv-continue');
    if (cont) cont.addEventListener('click', () => startReview('due'));
    document.getElementById('rv-top').addEventListener('click', () => { st.active = false; renderReview(); });
    document.getElementById('rv-home').addEventListener('click', () => { st.active = false; switchTab('home'); });
  }

  /* =========================================================
     書庫（採点なし・検索/しぼりこみ）
     ========================================================= */
  const libState = { search: '', unit: '', sub: '', type: '', diff: '', tag: '', status: '' };
  let pendingTag = null;
  let scopeOpen = false;
  let libLimit = 80;

  function openLibraryWithTag(tag) {
    pendingTag = tag || '';
    reviewState.active = false;
    switchTab('library');
  }

  const STATUS_FILTERS = [
    ['', 'すべての状態'], ['untouched', '未着手'], ['ng', 'わからない'],
    ['vague', 'あいまい'], ['ok', '完璧'], ['graduated', '定着'], ['unlearned', '未習'],
  ];

  /* 学習範囲（未習の一括設定） */
  function scopeState(unit, sub) {
    const { total, unlearned } = S.unlearnedStat(unit, sub);
    if (unlearned === 0) return 'on';
    if (unlearned === total) return 'off';
    return 'partial';
  }
  function scopeRowHTML(unit, sub) {
    const st = scopeState(unit, sub);
    const { total, unlearned } = S.unlearnedStat(unit, sub);
    const mark = st === 'on' ? I('check') : st === 'off' ? I('eyeoff') : I('tri');
    const note = st === 'off' ? `未習 ${total}` : st === 'partial' ? `未習 ${unlearned}/${total}` : `${total}問`;
    return `<button class="scope-row ${sub ? '' : 'top'} ${st}" data-unit="${esc(unit)}" ${sub ? `data-sub="${esc(sub)}"` : ''}>
      <span class="ck">${mark}</span>${!sub ? elm(unit) : ''}<span>${esc(sub || unit)}</span><span class="nt">${note}</span></button>`;
  }
  function scopePanelHTML() {
    return `<div class="card scope"><p>まだ授業で習っていない単元・分野を押すと「未習」になり、演習・復習・分析から外れます。もう一度押すと戻ります。</p>
      ${orderedUnits().map(u => `<div class="scope-unit">${scopeRowHTML(u, null)}<div class="scope-subs">${S.subUnitsOfUnit(u).map(s => scopeRowHTML(u, s)).join('')}</div></div>`).join('')}</div>`;
  }

  function libFiltered() {
    const t = libState.search.toLowerCase();
    return S.questions().filter(q => {
      const si = S.statusInfo(q.id);
      return (!libState.unit || q.unit === libState.unit)
        && (!libState.sub || q.sub_unit === libState.sub)
        && (!libState.type || q.question_type === libState.type)
        && (!libState.diff || String(q.difficulty) === libState.diff)
        && (!libState.tag || (' ' + q.tags + ' ').includes(' ' + libState.tag + ' '))
        && (!libState.status || si.key === libState.status)
        && (!t || (q.question + ' ' + q.answer + ' ' + q.tags).toLowerCase().includes(t));
    });
  }

  function libItemHTML(q) {
    const si = S.statusInfo(q.id);
    const c = S.commentOf(q.id);
    const bm = S.isBookmarked(q.id);
    const unl = S.isUnlearned(q.id);
    return `<details class="item" data-qid="${esc(q.id)}">
      <summary class="li">${statusMark(si.key)}<span class="lq">${esc(q.question)}</span></summary>
      <div class="ibody">
        <div class="imeta">${elm(q.unit)}<span>${esc(si.label.replace('🎓', ''))}</span>${q.origin === 'custom' ? '<span class="chip custom">自作</span>' : ''}<span class="chip">${esc(q.sub_unit)}</span><span class="chip">${esc(q.question_type)}</span>${diffDots(q.difficulty)}</div>
        <div class="ans"><div class="tagq">ANSWER</div><p>${esc(q.answer)}</p></div>
        ${q.tags ? `<div class="tags">${q.tags.split(' ').filter(Boolean).map(tg => `<button data-tag="${esc(tg)}">#${esc(tg)}</button>`).join('')}</div>` : ''}
        ${c ? `<div class="memo">${I('pencil', 's14')}<span>${esc(c)}</span></div>` : ''}
        <div class="iact"><button class="mini ${bm ? 'on' : ''}" data-act="star">${I('star')}${bm ? '保存中' : '保存'}</button><span class="sp"></span><button class="mini ${unl ? 'act' : ''}" data-act="unlearned">${I(unl ? 'undo' : 'eyeoff')}${unl ? '未習を解除' : '未習にする'}</button></div>
      </div></details>`;
  }

  function renderLibrary() {
    setChrome(false);
    if (pendingTag !== null) { libState.tag = pendingTag; pendingTag = null; }
    if (!S.questions().length) { renderEmpty(); return; }
    const units = orderedUnits();
    const subChoices = libState.unit ? S.subUnitsOfUnit(libState.unit) : S.subUnits();
    const unlearnedN = S.questions().filter(q => S.isUnlearned(q.id)).length;
    view.innerHTML = `${pageTitle('書庫', `<span id="lib-count"></span>`)}
      <div class="body">
        <label class="search">${I('search', 's18')}<input type="search" id="lib-search" placeholder="問題文・答え・キーワード" value="${esc(libState.search)}"></label>
        <div class="pills">
          <button class="pill gold" data-act="scope">${I('layers')}学習範囲${unlearnedN ? ` ・未習${unlearnedN}` : ''}</button>
          <select class="pill ${libState.unit ? 'on' : ''}" id="lib-unit" aria-label="単元"><option value="">単元</option>${units.map(u => `<option value="${esc(u)}" ${libState.unit === u ? 'selected' : ''}>${esc(unitMeta(u).short)}</option>`).join('')}</select>
          <select class="pill ${libState.sub ? 'on' : ''}" id="lib-sub" aria-label="分野"><option value="">分野</option>${subChoices.map(s => `<option value="${esc(s)}" ${libState.sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          <select class="pill ${libState.status ? 'on' : ''}" id="lib-status" aria-label="状態">${STATUS_FILTERS.map(([v, l]) => `<option value="${v}" ${libState.status === v ? 'selected' : ''}>${v ? esc(l) : '状態'}</option>`).join('')}</select>
          <select class="pill ${libState.type ? 'on' : ''}" id="lib-type" aria-label="タイプ"><option value="">タイプ</option>${S.TYPES.map(t => `<option ${libState.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select class="pill ${libState.diff ? 'on' : ''}" id="lib-diff" aria-label="難易度"><option value="">難易度</option>${['1', '2', '3'].map(d => `<option value="${d}" ${libState.diff === d ? 'selected' : ''}>難易度 ${d}</option>`).join('')}</select>
        </div>
        ${scopeOpen ? scopePanelHTML() : ''}
        ${libState.tag ? `<div class="activetag">しぼりこみ中<span class="pill on">#${esc(libState.tag)}</span><button class="mini" id="clear-tag">${I('x')}解除</button></div>` : ''}
        <div class="legendrow"><span>${statusMark('ok')}完璧</span><span>${statusMark('vague')}あいまい</span><span>${statusMark('ng')}わからない</span><span>${statusMark('graduated')}定着</span><span>${statusMark('untouched')}未着手</span><span>${statusMark('unlearned')}未習</span></div>
        <div class="card list" id="lib-list"></div>
      </div>`;

    const scopeBtn = view.querySelector('[data-act="scope"]');
    scopeBtn.addEventListener('click', () => { scopeOpen = !scopeOpen; renderLibrary(); });
    view.querySelectorAll('.scope-row').forEach(b => b.addEventListener('click', () => {
      const unit = b.dataset.unit, sub = b.dataset.sub || null;
      const turnOff = scopeState(unit, sub) === 'on';
      S.setUnlearnedScope(unit, sub, turnOff);
      toast(turnOff ? `${sub || unit} を未習にしました` : `${sub || unit} を学習範囲に戻しました`);
      updateBadges();
      renderLibrary();
    }));
    document.getElementById('lib-search').addEventListener('input', e => { libState.search = e.target.value; libLimit = 80; renderLibList(); });
    document.getElementById('lib-unit').addEventListener('change', e => {
      libState.unit = e.target.value;
      if (libState.sub && libState.unit && !S.subUnitsOfUnit(libState.unit).includes(libState.sub)) libState.sub = '';
      libLimit = 80; renderLibrary();
    });
    [['lib-sub', 'sub'], ['lib-type', 'type'], ['lib-diff', 'diff'], ['lib-status', 'status']].forEach(([id, key]) =>
      document.getElementById(id).addEventListener('change', e => { libState[key] = e.target.value; libLimit = 80; renderLibrary(); }));
    const ct = document.getElementById('clear-tag');
    if (ct) ct.addEventListener('click', () => { libState.tag = ''; renderLibrary(); });
    renderLibList();
  }

  function renderLibList() {
    const list = libFiltered();
    document.getElementById('lib-count').textContent = list.length + '問';
    const box = document.getElementById('lib-list');
    box.innerHTML = list.length
      ? list.slice(0, libLimit).map(libItemHTML).join('') + (list.length > libLimit ? `<div class="lib-more"><button class="mini" id="lib-more">もっと見る（あと${list.length - libLimit}問）</button></div>` : '')
      : '<p class="hint" style="padding:18px">該当する問題がありません</p>';
    const more = document.getElementById('lib-more');
    if (more) more.addEventListener('click', () => { libLimit += 120; renderLibList(); });
    box.querySelectorAll('details.item').forEach(bindLibItem);
  }
  // 1件ぶんのボタン（未習の切り替えはその1件だけ描き直す）
  function bindLibItem(d) {
    d.querySelectorAll('.tags [data-tag]').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); libState.tag = b.dataset.tag; renderLibrary(); window.scrollTo(0, 0); }));
    d.querySelector('[data-act="star"]').addEventListener('click', e => {
      const b = e.currentTarget;
      const on = S.toggleBookmark(d.dataset.qid);
      b.classList.toggle('on', on);
      b.innerHTML = `${I('star')}${on ? '保存中' : '保存'}`;
    });
    d.querySelector('[data-act="unlearned"]').addEventListener('click', () => {
      const id = d.dataset.qid;
      S.setUnlearned(id, !S.isUnlearned(id));
      toast(S.isUnlearned(id) ? '未習にしました' : '未習を解除しました');
      updateBadges();
      const tmp = document.createElement('div');
      tmp.innerHTML = libItemHTML(S.byId(id));
      const nd = tmp.firstElementChild;
      nd.open = true;
      d.replaceWith(nd);
      bindLibItem(nd);
    });
  }

  /* =========================================================
     分析
     ========================================================= */
  const statsState = { expandedUnit: undefined };

  function renderStats() {
    setChrome(false);
    if (!S.questions().length) { renderEmpty(); return; }
    const subStats = S.subUnits().map(su => [su, S.metrics(q => q.sub_unit === su)])
      .filter(([, m]) => m.attempted > 0)
      .sort((a, b) => (a[1].understanding ?? 1) - (b[1].understanding ?? 1));
    const weak3 = subStats.slice(0, 3);
    const units = orderedUnits();
    if (statsState.expandedUnit === undefined) {
      // 最初は、解いたことのある単元のうち理解度がいちばん低い単元を開いておく
      const tried = units.map(u => [u, S.metrics(q => q.unit === u)]).filter(([, m]) => m.attempted > 0)
        .sort((a, b) => (a[1].understanding ?? 1) - (b[1].understanding ?? 1));
      statsState.expandedUnit = tried.length ? tried[0][0] : null;
    }
    const exp = statsState.expandedUnit;
    const active = S.questions().filter(q => !S.isUnlearned(q.id)).length;
    const colorOf = v => v == null ? 'var(--dim2)' : v < .4 ? '#fb923c' : v < .7 ? '#fbbf24' : '#34d399';
    const tagWeak = S.tagMetrics().filter(t => t.attempted >= 3)
      .sort((a, b) => (a.understanding ?? 1) - (b.understanding ?? 1)).slice(0, 5);
    const custom = units.filter(u => !UNIT_ORDER.includes(u));

    let drill = '';
    if (exp) {
      const m = unitMeta(exp);
      const subs = S.subUnitsOfUnit(exp);
      drill = `<div class="card drillc"><div class="dhd"><b style="color:${m.color}">${esc(exp)} の分野別</b><span class="lg3"><span style="color:var(--green)">${I('o')}</span><span style="color:var(--yellow)">${I('tri')}</span><span style="color:var(--orange)">${I('x')}</span></span></div>
        ${subs.map(su => {
          const mm = S.metrics(q => q.unit === exp && q.sub_unit === su);
          const b = mm.statusBreak, n = b.ok + b.vague + b.ng;
          return `<div class="dr"><div class="dh"><span>${esc(su)}<small>${mm.attempted}/${mm.total}問${mm.graduated ? ` ・定着${mm.graduated}` : ''}</small></span><span class="v" style="color:${colorOf(mm.understanding)}">${pct(mm.understanding)}</span></div>${LAB.tube([['ok', b.ok], ['vague', b.vague], ['ng', b.ng]], n)}</div>`;
        }).join('')}</div>`;
    }

    view.innerHTML = `${pageTitle('分析')}
      <div class="body">
        ${weak3.length ? `<div class="card weak"><div class="wt">${I('alert', 's16')}いま優先したい分野</div>
          ${weak3.map(([su, m], i) => `<div class="wr"><span class="rk">${i + 1}</span><span class="nm">${esc(su)}</span>${LAB.mtube(m.understanding || 0, colorOf(m.understanding))}<span class="v" style="color:${colorOf(m.understanding)}">${pct(m.understanding)}</span></div>`).join('')}</div>`
        : `<div class="card weak"><div class="wt" style="color:var(--dim)">${I('alert', 's16')}いま優先したい分野</div><p class="hint" style="text-align:left">演習を進めると、苦手な分野がここに出てきます。</p></div>`}
        <div class="card mol"><div class="head"><span class="label">単元（押すと分野別）</span><span class="r"><b>${S.graduatedCount()}</b>/ ${active} 定着</span></div>${LAB.molecule(unitAtoms(), exp)}
          ${custom.length ? `<div class="pills" style="padding:2px 0 8px">${custom.map(u => `<button class="pill ${exp === u ? 'on' : ''}" data-unit="${esc(u)}">${elm(u)}${esc(u)}</button>`).join('')}</div>` : ''}</div>
        ${drill}
        ${tagWeak.length ? `<div class="card weak"><div class="wt" style="color:var(--cyan)">${I('hash', 's16')}キーワード別の弱点</div>
          ${tagWeak.map(t => `<button class="wr" data-tag="${esc(t.tag)}"><span class="nm">#${esc(t.tag)}</span>${LAB.mtube(t.understanding || 0, colorOf(t.understanding))}<span class="v" style="color:${colorOf(t.understanding)}">${pct(t.understanding)}</span></button>`).join('')}</div>` : ''}
      </div>`;
    const toggle = u => { statsState.expandedUnit = statsState.expandedUnit === u ? null : u; renderStats(); };
    bindAtoms(toggle);
    view.querySelectorAll('.pill[data-unit]').forEach(b => b.addEventListener('click', () => toggle(b.dataset.unit)));
    view.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => openLibraryWithTag(b.dataset.tag)));
  }

  /* =========================================================
     マイ
     ========================================================= */
  function renderMe() {
    setChrome(false);
    const li = levelInfo();
    const d = S.raw();
    const customs = S.questions().filter(q => q.origin === 'custom').length;
    const saved = d.bookmarks.filter(id => S.byId(id)).length;
    const unlearnedN = S.questions().filter(q => S.isUnlearned(q.id)).length;
    view.innerHTML = `${pageTitle('マイ')}
      <div class="body">
        <div class="card me"><div class="top"><div class="av">${I('flask')}</div><div style="flex:1"><div class="lvl" style="font-size:13px">Lv.${li.lv}</div><div class="ti">${esc(li.title)}</div></div></div>
          <div><div class="exp"><span style="width:${Math.round(li.ratio * 100)}%"></span></div><div class="nx"><span>${li.exp} / ${li.next} EXP</span><span>${li.nextTitle ? '次の称号: ' + esc(li.nextTitle) : ''}</span></div></div></div>
        <div class="card list">
          <button class="li u5" data-go="saved"><span class="ib">${I('star', 's18')}</span><span class="tx">保存した問題</span><span class="rt">${saved}${I('chev', 's16')}</span></button>
          <button class="li u3" data-go="custom"><span class="ib">${I('pencil', 's18')}</span><span class="tx">自作問題</span><span class="rt">${customs}${I('chev', 's16')}</span></button>
          <button class="li ug" data-act="scope-go"><span class="ib">${I('layers', 's18')}</span><span class="tx">学習範囲<small>習っていない単元を外す</small></span><span class="rt">${unlearnedN ? '未習 ' + unlearnedN : ''}${I('chev', 's16')}</span></button>
          <button class="li u1" data-act="exam"><span class="ib">${I('cap', 's18')}</span><span class="tx">入試日<small>おまかせの新しい問題の数が決まる</small></span><span class="rt">${examDaysLeft() > 0 ? 'あと' + examDaysLeft() + '日' : '未設定'}${I('chev', 's16')}</span></button>
          <button class="li u2" data-go="sync"><span class="ib">${I('cloud', 's18')}</span><span class="tx">同期・バックアップ<small>友達に教える・フィードバックもここ</small></span><span class="rt">${d.syncId ? '<i class="ok"></i>同期中' : ''}${I('chev', 's16')}</span></button>
          <button class="li" data-act="help"><span class="ib">${I('help', 's18')}</span><span class="tx">使い方</span><span class="rt">${I('chev', 's16')}</span></button>
        </div>
        ${routeMe()}
      </div>`;
    view.querySelector('[data-act="scope-go"]').addEventListener('click', () => { scopeOpen = true; switchTab('library'); });
  }

  /* =========================================================
     保存した問題 / 自作問題（マイの中）
     ========================================================= */
  let savedTab = 'saved';
  let cqEditId = null; // 編集中の自作問題id（nullなら新規作成モード）

  function savedItemHTML(q, custom) {
    const c = S.commentOf(q.id);
    const si = S.statusInfo(q.id);
    return `<details class="item" data-qid="${esc(q.id)}">
      <summary class="li">${custom ? statusMark(si.key) : elm(q.unit)}<span class="lq">${esc(q.question)}</span>${I('chevd', 's16')}</summary>
      <div class="ibody">
        <div class="imeta">${custom ? '' : elm(q.unit)}<span class="chip">${esc(q.sub_unit)}</span><span class="chip">${esc(q.question_type)}</span>${diffDots(q.difficulty)}</div>
        <div class="ans"><div class="tagq">ANSWER</div><p>${esc(q.answer)}</p></div>
        ${c ? `<div class="memo">${I('pencil', 's14')}<span>${esc(c)}</span></div>` : ''}
        <div class="iact"><span class="sp"></span>${custom
          ? `<button class="mini" data-act="cq-edit">${I('pencil')}編集</button><button class="mini warn" data-act="cq-del">${I('trash')}削除</button>`
          : `<button class="mini warn" data-act="unstar">${I('star')}保存から外す</button>`}</div>
      </div></details>`;
  }

  function renderSaved() {
    setChrome(false);
    const saved = S.raw().bookmarks.map(id => S.byId(id)).filter(Boolean);
    const customs = S.questions().filter(q => q.origin === 'custom');
    const editing = cqEditId ? S.byId(cqEditId) : null;
    if (!editing) cqEditId = null; // 削除済みidの編集状態は捨てる
    const isCustom = savedTab === 'custom';

    const savedHTML = saved.length
      ? `<div class="card list">${saved.map(q => savedItemHTML(q, false)).join('')}</div>`
      : `<div class="card empty"><div class="fl">${LAB.flask({ layers: [['#f472b6', .08]] })}</div><h2>保存した問題はまだありません</h2><p>問題カードの ☆ を押すと、大事な問題をここにストックできます。</p></div>`;

    const formHTML = `<div class="card form" id="cq-form">
        <h3>${I(editing ? 'pencil' : 'plus', 's18')}${editing ? '自作問題を編集' : '自作問題を追加'}</h3>
        <textarea class="field" id="cq-q" rows="2" placeholder="問題文（例: 〇〇の工業的製法で使う触媒は？）">${editing ? esc(editing.question) : ''}</textarea>
        <textarea class="field" id="cq-a" rows="2" placeholder="答え（1〜2行で簡潔に）">${editing ? esc(editing.answer) : ''}</textarea>
        <div class="row3">
          <input class="field" type="text" id="cq-sub" list="cq-sub-list" placeholder="分野（任意）" value="${editing ? esc(editing.sub_unit === 'その他' ? '' : editing.sub_unit) : ''}">
          <select class="field" id="cq-type">${S.TYPES.map(t => `<option value="${esc(t)}" ${editing && editing.question_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select class="field" id="cq-diff">${[1, 2, 3].map(n => `<option value="${n}" ${(editing ? editing.difficulty : 2) === n ? 'selected' : ''}>難易度${n}</option>`).join('')}</select>
        </div>
        <datalist id="cq-sub-list">${S.subUnits().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
        <input class="field" type="text" id="cq-tags" placeholder="キーワード（スペース区切り・任意）" value="${editing ? esc(editing.tags) : ''}">
        <div class="btnrow"><button class="btn primary sm" id="cq-save">${editing ? '更新する' : '追加する'}</button>${editing ? '<button class="btn second sm" id="cq-cancel">キャンセル</button>' : ''}</div>
        <p class="desc">演習・復習（忘却曲線）にも普通に混ざって出題されます。他の人には共有されません。</p>
      </div>`;
    const customHTML = `${formHTML}${customs.length ? `<div class="card list">${customs.map(q => savedItemHTML(q, true)).join('')}</div>` : ''}`;

    view.innerHTML = `${backTitle(isCustom ? '自作問題' : '保存した問題')}
      <div class="body">
        <div class="seg"><button class="${!isCustom ? 'on' : ''}" data-st="saved">${I('star', 's14')}保存 <span class="n">${saved.length}</span></button><button class="${isCustom ? 'on' : ''}" data-st="custom">${I('pencil', 's14')}自作 <span class="n">${customs.length}</span></button></div>
        ${isCustom ? customHTML : savedHTML}
      </div>
      ${!isCustom ? `<button class="fab" data-st="custom">${I('plus', 's18')}自作問題</button>` : ''}`;

    view.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => { savedTab = b.dataset.st; renderSaved(); window.scrollTo(0, 0); }));
    view.querySelectorAll('[data-act="unstar"]').forEach(btn => btn.addEventListener('click', () => {
      S.toggleBookmark(btn.closest('details').dataset.qid);
      toast('保存から外しました');
      renderSaved();
    }));

    if (!isCustom) return;
    document.getElementById('cq-save').addEventListener('click', () => {
      const fields = {
        question: document.getElementById('cq-q').value.trim(),
        answer: document.getElementById('cq-a').value.trim(),
        sub_unit: document.getElementById('cq-sub').value.trim(),
        question_type: document.getElementById('cq-type').value,
        difficulty: document.getElementById('cq-diff').value,
        tags: document.getElementById('cq-tags').value,
      };
      if (!fields.question || !fields.answer) { toast('問題文と答えを入力してください', 'bad'); return; }
      if (cqEditId) {
        S.updateQuestion(cqEditId, fields);
        cqEditId = null;
        toast('自作問題を更新しました', 'good');
      } else {
        const res = S.addQuestion({ ...fields, unit: '自作問題', origin: 'custom' });
        if (res === 'skipped') { toast('同じ問題文がすでにあります', 'bad'); return; }
        S.persist();
        toast('自作問題を追加しました。演習にも出てきます', 'good');
      }
      renderSaved();
    });
    const cqCancel = document.getElementById('cq-cancel');
    if (cqCancel) cqCancel.addEventListener('click', () => { cqEditId = null; renderSaved(); });
    view.querySelectorAll('[data-act="cq-edit"]').forEach(btn => btn.addEventListener('click', () => {
      cqEditId = btn.closest('details').dataset.qid;
      renderSaved();
      document.getElementById('cq-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    view.querySelectorAll('[data-act="cq-del"]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.closest('details').dataset.qid;
      if (!confirm('この自作問題を削除しますか？（進捗・メモも消えます）')) return;
      if (cqEditId === id) cqEditId = null;
      S.deleteQuestion(id);
      toast('削除しました');
      renderSaved();
    }));
  }

  /* =========================================================
     同期・バックアップ（マイの中）
     ========================================================= */
  function renderSync() {
    setChrome(false);
    const d = S.raw();
    const configured = !!S.dbUrl();
    const ago = ts => {
      if (!ts) return 'まだ保存していません';
      const m = Math.round((Date.now() - ts) / 60000);
      return m < 1 ? 'たった今保存' : m < 60 ? `${m}分前に保存` : new Date(ts).toLocaleString('ja-JP') + 'に保存';
    };

    const cloudHTML = configured ? `
      <div class="card p16"><div class="cardh u2"><span class="ib">${I('key')}</span>同期ID${d.syncId ? `<span class="r"><i></i>${esc(ago(d.lastSync))}</span>` : ''}</div>
        ${d.syncId ? `
          <div class="idbox" id="sync-id-text">${esc(d.syncId)}</div>
          <div class="btnrow"><button class="btn second sm" id="copy-id">${I('copy')}コピー</button><button class="btn primary sm" id="push-now">${I('cloud')}今すぐ保存</button></div>
          <p class="desc">別の端末でこのIDを入力すると、続きから学習できます。変更は数秒後に自動で保存されます。</p>`
        : `<p class="desc">ログイン不要。同期IDを発行すると学習データがクラウドに保存され、別の端末でIDを入力すれば続きから学習できます。</p>
          <button class="btn primary sm" id="create-id">${I('key')}同期IDを発行する</button>`}
      </div>
      <div class="card p16"><div class="cardh u1"><span class="ib">${I('download')}</span>同期IDから復元</div>
        <input class="field" type="text" id="pull-id" placeholder="CF-XXXX-XXXX-XXXX" autocomplete="off">
        <div class="warn">${I('alert', 's14')}この端末のデータは、クラウドの内容で上書きされます</div>
        <button class="btn second sm" id="pull-btn">復元する</button></div>`
      : `
      <div class="card p16"><div class="cardh u2"><span class="ib">${I('cloud')}</span>クラウド同期（未設定）</div>
        <p class="desc">クラウド同期を使うには、Firebase Realtime Database のURLをここに設定します。設定するまでは下の「ファイルで引っ越し」で端末間の引っ越しができます。</p>
        <input class="field" type="text" id="db-url" placeholder="https://xxxx-default-rtdb.....firebasedatabase.app">
        <button class="btn primary sm" id="db-save">接続テストして保存</button></div>`;

    view.innerHTML = `${backTitle('同期・バックアップ')}
      <div class="body">
        ${cloudHTML}
        <div class="card p16"><div class="cardh u3"><span class="ib">${I('phone')}</span>ファイルで引っ越し</div>
          <div class="btnrow"><button class="btn second sm" id="backup-btn">${I('download')}書き出す</button>
            <label class="btn second sm" style="cursor:pointer">${I('upload')}読み込む<input type="file" id="restore-file" accept=".json,application/json" hidden></label></div></div>
        <div class="card p16"><div class="cardh u1"><span class="ib">${I('share')}</span>友達に教える</div>
          <div class="share"><div class="qr"><img src="qr.svg" alt="アプリのQRコード" width="92" height="92"></div>
            <div class="side"><div class="url">${esc(APP_URL)}</div><div class="btnrow"><button class="btn primary sm" id="share-btn">${I('share')}送る</button><button class="btn second sm" id="share-copy">${I('copy')}コピー</button></div></div></div>
          <p class="desc">無料・登録不要・ログイン不要。「ホーム画面に追加」するとアプリとして使えます。</p></div>
        <div class="card p16" id="fb-card"><div class="cardh u4"><span class="ib">${I('msg')}</span>フィードバック</div>
          <textarea class="field" id="fb-text" rows="3" placeholder="不具合・誤字・「ここが使いにくい」など（返信はできません）"></textarea>
          <button class="btn primary sm" id="fb-send">送信する</button></div>
        <div class="note">${I('key', 's16')}<span>同期IDは合言葉。知っている人は誰でも見られるので、メモに個人情報は書かないでください。</span></div>
      </div>`;

    const busy = (btn, label) => { btn.disabled = true; btn.textContent = label; };

    const shareText = '高校化学の暗記チェックアプリ「ChemFlash」 無料・登録不要！';
    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(shareText + ' ' + APP_URL);
        toast('リンクをコピーしました', 'good');
      } catch (e) { toast('コピーできませんでした。URLを直接見せてください', 'bad'); }
    };
    document.getElementById('share-btn').addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'ChemFlash', text: shareText, url: APP_URL }); }
        catch (e) { /* 共有シートのキャンセルは何もしない */ }
      } else copyLink();
    });
    document.getElementById('share-copy').addEventListener('click', copyLink);

    const dbSave = document.getElementById('db-save');
    if (dbSave) dbSave.addEventListener('click', async () => {
      const url = document.getElementById('db-url').value.trim().replace(/\/+$/, '');
      if (!/^https:\/\//.test(url)) { toast('https:// から始まるURLを入力してください', 'bad'); return; }
      busy(dbSave, '接続テスト中…');
      try {
        const res = await fetch(url + '/chemflash/connection_test.json', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ at: Date.now() }),
        });
        if (!res.ok) throw new Error('接続できましたが書き込みできません (' + res.status + ')。ルール設定を確認してください');
        S.setDbUrl(url);
        toast('同期サーバを設定しました', 'good');
      } catch (e) { toast(e.message === 'Failed to fetch' ? 'URLに接続できませんでした' : e.message, 'bad'); }
      renderSync();
    });

    const createBtn = document.getElementById('create-id');
    if (createBtn) createBtn.addEventListener('click', async () => {
      busy(createBtn, '発行中…');
      try { await S.syncCreate(); toast('同期IDを発行しました', 'good'); }
      catch (e) { toast(e.message, 'bad'); }
      renderSync();
    });

    const copyBtn = document.getElementById('copy-id');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.syncId); toast('コピーしました', 'good'); }
      catch (e) { toast('コピーできませんでした。長押し/選択でコピーしてください', 'bad'); }
    });

    const pushBtn = document.getElementById('push-now');
    if (pushBtn) pushBtn.addEventListener('click', async () => {
      busy(pushBtn, '保存中…');
      try { await S.syncPush(); toast('クラウドに保存しました', 'good'); }
      catch (e) { toast(e.message, 'bad'); }
      renderSync();
    });

    const pullBtn = document.getElementById('pull-btn');
    if (pullBtn) pullBtn.addEventListener('click', async () => {
      const id = document.getElementById('pull-id').value;
      if (!id.trim()) { toast('同期IDを入力してください', 'bad'); return; }
      if (!confirm('この端末のデータをクラウドの内容で上書きします。よろしいですか？')) return;
      try {
        await S.syncPull(id);
        reviewState.pool = null; reviewState.active = false;
        toast('復元しました', 'good');
        switchTab('home');
      } catch (e) { toast(e.message, 'bad'); }
    });

    document.getElementById('backup-btn').addEventListener('click', () => {
      const blob = new Blob([S.exportBackup()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chemflash_backup_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('バックアップを書き出しました', 'good');
    });

    const fbSend = document.getElementById('fb-send');
    fbSend.addEventListener('click', async () => {
      const text = document.getElementById('fb-text').value.trim();
      if (!text) { toast('内容を入力してください', 'bad'); return; }
      busy(fbSend, '送信中…');
      try {
        await S.sendFeedback(text);
        toast('送信しました。ありがとうございます！', 'good');
        renderSync();
      } catch (e) {
        toast(e.message, 'bad');
        fbSend.disabled = false; fbSend.textContent = '送信する';
      }
    });

    document.getElementById('restore-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('この端末のデータをバックアップファイルの内容で上書きします。よろしいですか？')) { e.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          S.importBackup(String(reader.result));
          reviewState.pool = null; reviewState.active = false;
          toast('復元しました', 'good');
          switchTab('home');
        } catch (err) { toast(err.message, 'bad'); }
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });

    if (syncFocusFeedback) {
      syncFocusFeedback = false;
      const fc = document.getElementById('fb-card');
      fc.scrollIntoView({ block: 'center' });
      document.getElementById('fb-text').focus({ preventScroll: true });
    }
  }
  let syncFocusFeedback = false;

  /* ---------- 問題ゼロ ---------- */
  function renderEmpty() {
    setChrome(false);
    view.innerHTML = `${brandbar()}<div class="body"><div class="card empty"><div class="fl">${LAB.flask({})}</div><h2>問題を読み込んでいます</h2><p>しばらくしても表示されないときは、通信状態を確認してページを開き直してください。</p></div></div>`;
  }

  /* ---------- ナビ ---------- */
  function updateBadges() {
    const n = S.dueCount() + S.reviewWrongIds().length;
    const badge = document.getElementById('review-badge');
    if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : n; }
  }

  const renderers = {
    home: renderPractice,
    review: renderReview,
    library: renderLibrary,
    stats: renderStats,
    me: renderMe,
    saved: () => { savedTab = 'saved'; renderSaved(); },
    custom: () => { savedTab = 'custom'; renderSaved(); },
    sync: renderSync,
  };
  const TAB_OF = { saved: 'me', custom: 'me', sync: 'me' };

  function markTab(name) {
    const tab = TAB_OF[name] || name;
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  }

  let currentTab = 'home';
  function switchTab(name) {
    if (!renderers[name]) name = 'home';
    currentTab = name;
    closeSetup();
    markTab(name);
    if (name === 'review') { reviewState.pool = null; reviewState.active = false; }
    updateBadges();
    renderers[name]();
    window.scrollTo(0, 0);
  }
  window.switchTab = switchTab;

  document.querySelectorAll('#tabbar button').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // 画面のどこからでも使うボタン（使い方・移動・Route の広告を閉じる）
  view.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { switchTab(go.dataset.go); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'help') openHelp();
    else if (act.dataset.act === 'exam') openExam();
    else if (act.dataset.act === 'route-hide') {
      e.preventDefault();
      ui.routeHideUntil = Date.now() + 7 * 86400000; // 7日間は出さない
      saveUi();
      const ad = act.closest('.rad');
      if (ad) ad.remove();
    }
  });

  /* ---------- 使い方ダイアログ（図で見せる。中身は見本の数字で、学習データは読むだけ） ---------- */
  const helpDialog = document.getElementById('help-dialog');
  const helpBody = document.getElementById('help-body');

  function helpSec(id, icon, color, title, fig, note = '') {
    return `<section class="hsec" id="h-${id}" style="--c:${color}"><h3><span class="ib">${I(icon)}</span>${title}</h3>
      <div class="hfig" inert>${fig}</div>${note}</section>`;
  }
  function buildHelp() {
    const demoAtoms = UNIT_ORDER.map((u, i) => { const m = unitMeta(u); return { unit: 'demo' + i, unitAttr: '', label: '', sym: m.sym, color: m.color, p: [.62, .38, .8, .24, .5][i] }; });
    const co = n => `<i class="co">${n}</i>`;
    const li = levelInfo();

    // ① ホーム（見本の画面に番号）
    const home = `<div class="shot"><div class="shot-in">
        <div class="level"><div class="lvbadge">${I('flask')}</div><div class="info"><div class="line1"><span class="lvl">Lv.3</span><span class="ltitle">見習い化学者</span><span class="exp-n">120 / 150 EXP</span></div><div class="exp"><span style="width:60%"></span></div></div></div>
        <div class="today">${co(1)}<span class="tc fire">${I('flame')}<b>5</b>日連続</span><span class="tc">今日 <b>8</b>/20</span><span class="tc">${I('cap')}あと <b>111</b>日</span></div>
        <div class="body">
          <div class="quest">${co(2)}<div class="fl">${LAB.flask({ layers: [['#45e3cf', .2], ['#fb923c', .12], ['#4cc9f0', .3]], glow: '#4cc9f0', bubbles: true })}</div><div class="qtx"><div class="tagq">TODAY</div><span class="label">今日のおまかせ</span><div class="num">20<small>問</small></div><div class="mix"><span style="--c:#45e3cf"><i></i>復習 6</span><span style="--c:#fb923c"><i></i>間違い 4</span><span style="--c:#4cc9f0"><i></i>新しい 10</span></div></div><span class="play">${I('play')}</span></div>
          <div class="card mol">${co(3)}<div class="head"><span class="label">単元</span><span class="r"><b>36</b>/ 880 定着</span></div>${LAB.molecule(demoAtoms, null)}</div>
          <div class="quick">${co(4)}<button class="u1"><span class="ib">${I('tube')}</span>演習</button><button class="u4"><span class="ib">${I('target')}</span>間違い復習</button><button class="u2"><span class="ib">${I('timer')}</span>15分</button><button class="u5"><span class="ib">${I('star')}</span>保存</button></div>
        </div></div></div>
      <ol class="coleg"><li><b>1</b>続けた日数・今日の数・入試まで</li><li><b>2</b>押すだけで今日の分（おまかせ）</li><li><b>3</b>単元ごとの理解度</li><li><b>4</b>範囲を選ぶ・間違い復習・15分・保存</li></ol>`;

    // 今日のおまかせ・入試日・続けた日数
    const planFig = `<div class="pbar"><span style="--c:#45e3cf">復習</span><span style="--c:#fb923c">間違い</span><span style="--c:#4cc9f0">新しい</span><span style="--c:#a78bfa">おさらい</span></div>
      <div class="pcap"><span>期限が古い順<br>10問まで</span><span>5問<br>まで</span><span>習った<br>範囲から</span><span>足りない<br>とき</span></div>
      <p class="cap">▶ を押すだけで、この順に 20問ほど出る</p>
      <div class="pexam">${I('cap', 's16')}<span>入試まで <b>111</b>日</span>${I('chev', 's14')}<span>新しい問題 1日 <b>8</b>問</span></div>
      <p class="cap sm">入試日を入れると、入試の1週間前までに一通り終わる数に自動で（マイ › 入試日）</p>
      <div class="pdays">${[1, 1, 1, 0, 1, 1, 1].map((on, i) => `<span class="${on ? 'on' : 'off'}">${on ? I('flame') : ''}<small>${'月火水木金土日'[i]}</small></span>`).join('')}</div>
      <p class="cap">1日休んでも、続けた日数は途切れない（2日休むとリセット）</p>`;

    // ② 解き方（3つのビーカー）
    const solve = `<div class="hflow"><span class="st">${I('play', 's14')}始める</span>${I('chev', 's14')}<span class="st">答えを見る</span>${I('chev', 's14')}<span class="st on">ビーカーを選ぶ</span></div>
      <div class="beakers">${LAB.beaker('ng', I('x'), 'わからない')}${LAB.beaker('vague', I('tri'), 'あいまい')}${LAB.beaker('ok', I('o'), '完璧')}</div>
      <div class="bcap"><span>次に関連問題<br>＋間違い復習へ</span><span>間違い復習へ</span><span>次の復習は<br>もっと先に</span></div>`;

    // ③ 試験管 → フラスコ
    const flaskFig = `<div class="htube">${LAB.tube([['ok', 9], ['vague', 3], ['ng', 2]], 20)}<span>14/20</span></div>
      <p class="cap">答えるたびに、試験管に色がたまる</p>
      <div class="harrow">${I('chevd', 's18')}</div>
      <div class="hres"><div class="fk">${LAB.flask({ layers: [['#fb923c', 2 / 14 * .9], ['#fbbf24', 3 / 14 * .9], ['#34d399', 9 / 14 * .9]], glow: '#34d399', bubbles: true, spark: true })}</div>
        <div class="tx"><p>終わると、結果が<b>フラスコ</b>に</p><div class="legend3"><span style="color:var(--green)">${I('o')}9</span><span style="color:var(--yellow)">${I('tri')}3</span><span style="color:var(--orange)">${I('x')}2</span></div><p class="sm">緑が多いほど よくできた回</p></div></div>`;

    // ④ EXP とレベル
    const steps = TITLES.map(([lv, name], i) => {
      const here = li.lv >= lv && (!TITLES[i + 1] || li.lv < TITLES[i + 1][0]);
      return `<div class="sp${here ? ' here' : ''}" style="--h:${22 + i * 11}px">${here ? '<em>いまここ</em>' : ''}<span class="bar"></span><b>Lv.${lv}</b><span class="nm">${({ '見習い化学者': '見習い<br>化学者', '主任研究員': '主任<br>研究員', '化学の賢者': '化学の<br>賢者' })[name] || name}</span><span class="q">${expAt(lv).toLocaleString()}</span></div>`;
    }).join('');
    const expFig = `<div class="hexp"><span class="g k-ok">${I('o')}</span><span class="g k-vague">${I('tri')}</span><span class="g k-ng">${I('x')}</span><span class="eq">=</span><span class="plus">+1<small>EXP</small></span></div>
      <p class="cap">どれを選んでも 1問 = 1 EXP。解いた数だけ上がる</p>
      <div class="stairs">${steps}</div>
      <p class="cap sm">下の数字 = そのレベルまでに解く数（くり返しも数える）</p>`;

    // ⑤ 原子 = 単元
    const mol = `<div class="hmol">${LAB.molecule(demoAtoms, null)}</div>
      <div class="ukey">${UNIT_ORDER.map(u => { const m = unitMeta(u); return `<span style="--c:${m.color}"><b>${m.sym}</b>${u === '高分子化合物' ? '高分子' : u}</span>`; }).join('')}</div>
      <div class="hpts"><div><span class="ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="#222d4a" stroke-width="4"/><circle cx="18" cy="18" r="14" fill="none" stroke="#34d399" stroke-width="4" stroke-linecap="round" stroke-dasharray="88" stroke-dashoffset="35" transform="rotate(-90 18 18)"/></svg></span><p><b>輪の長さ</b>＝いま「完璧」の問題の割合</p></div>
        <div><span class="ring">${I('chart')}</span><p><b>原子を押す</b>と、その単元の分野別の理解度へ</p></div></div>`;

    // ⑥ 復習のしくみ
    const node = (fill, label, sub) => `<div class="nd"><div class="v">${fill == null ? `<span class="cap-ic">${I('cap')}</span>` : LAB.vial([['#45e3cf', fill]], '#45e3cf')}</div><b>${label}</b><span>${sub}</span></div>`;
    const review = `<div class="tl">${node(.33, '今日', '完璧')}<i class="ar"><small>7日</small>${I('chev', 's14')}</i>${node(.66, '7日後', '完璧')}<i class="ar"><small>30日</small>${I('chev', 's14')}</i>${node(1, '30日後', '完璧')}<i class="ar">${I('chev', 's14')}</i>${node(null, '定着', '卒業')}</div>
      <div class="tlbad">${I('undo', 's16')}<span><b class="o">×</b> や <b class="y">△</b> を付けると、7日後にまた出る（× は最初から）</span></div>
      <div class="two"><div><span class="t">${I('rotate', 's16')}今日の復習</span><p>期限が来た問題を古い順に（1度に20問まで）</p></div><div><span class="t o">${I('target', 's16')}間違い復習</span><p>×・△の問題を、完璧になるまで</p></div></div>`;

    // ⑦ 下のタブ
    const tabs = [['house', 'ホーム', 'すぐ始める'], ['rotate', '復習', '今日の分'], ['book', '書庫', '全問を見る'], ['chart', '分析', '苦手を探す'], ['user', 'マイ', '保存・同期']];
    const tabFig = `<div class="htabs">${tabs.map(([ic, n, d]) => `<div><span class="ic2">${I(ic)}</span><b>${n}</b><span>${d}</span></div>`).join('')}</div>`;

    // ⑧ 便利な機能
    const tips = [['undo', 'var(--cyan)', '取り消す', '押し間違えたら、下に出るボタンで直前の1問を戻す'], ['layers', 'var(--gold)', '範囲を保存', '演習の範囲は いくつでも選べて、名前を付けて保存できる'], ['star', 'var(--pink)', '保存', 'あとで見返す問題に'], ['pencil', 'var(--green)', 'メモ', '覚え方などを一言'], ['eyeoff', 'var(--violet)', 'まだ習ってない', '出題から外す（書庫・マイで戻せる）'], ['phone', 'var(--cyan)', 'ホーム画面に追加', 'ブラウザのメニューから。アプリのように開ける']];
    const tipFig = `<div class="htips">${tips.map(([ic, c, n, d]) => `<div style="--c:${c}"><span class="ib">${I(ic)}</span><b>${n}</b><span>${d}</span></div>`).join('')}</div>`;

    // ⑨ Route とは
    const route = `<section class="hsec" id="h-route"><h3><span class="ib rmk2">R</span>Route とは？<span class="prtag">PR</span></h3>
      <div class="rad radM hroute"><a class="cover" href="${ROUTE_URL}" target="_blank" rel="noopener">
        <div class="hd">${routeLogo}</div>
        <div class="catch">理系の<em>オンライン個別指導</em>です</div>
        <div class="feats"><span>${I('video')}1対1の授業</span><span>${I('cam')}質問・添削</span><span>${I('gift')}無料体験2回</span></div>
        <div class="rsteps"><div><b>1</b>解けない問題を写真で送る</div><div><b>2</b>先生が添削して返す（48時間以内）</div></div>
        <div class="ft"><span class="go">サイトを見る${I('ext')}</span><span class="url">高校生・浪人生<br>数学・物理・化学</span></div></a></div>
      <p class="rnote">${I('check', 's14')}ChemFlash はこのまま無料で使えます。Route は気になった人だけどうぞ（ホームの広告は × で7日間かくせます）。</p></section>`;

    const toc = [['home', 'ホーム'], ['plan', 'おまかせ'], ['solve', '解き方'], ['flask', 'フラスコ'], ['exp', 'EXP'], ['mol', '単元'], ['review', '復習'], ['tabs', 'タブ'], ['route', 'Route']];
    helpBody.innerHTML = `<nav class="htoc">${toc.map(([id, n]) => `<button data-h="${id}">${n}</button>`).join('')}</nav>
      ${helpSec('home', 'house', 'var(--cyan)', 'ホームの見かた', home)}
      ${helpSec('plan', 'play', 'var(--cyan)', '今日のおまかせ', planFig)}
      ${helpSec('solve', 'tube', 'var(--green)', '問題の解き方', solve)}
      ${helpSec('flask', 'flask', 'var(--teal)', '試験管とフラスコ', flaskFig)}
      ${helpSec('exp', 'star', 'var(--gold)', 'EXP とレベル', expFig, `<p class="hnote">いま <b>Lv.${li.lv} ${esc(li.title)}</b>（${li.exp} EXP）${li.nextTitle ? `。次の称号は「${esc(li.nextTitle)}」` : ''}</p>`)}
      ${helpSec('mol', 'layers', 'var(--violet)', '原子 = 単元', mol)}
      ${helpSec('review', 'rotate', 'var(--teal)', '復習のしくみ（忘却曲線）', review)}
      ${helpSec('tabs', 'house', 'var(--cyan)', '下のタブ', tabFig)}
      ${helpSec('tips', 'star', 'var(--pink)', '便利な機能', tipFig)}
      ${route}`;
    helpBody.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => {
      const t = helpBody.querySelector('#h-' + b.dataset.h);
      if (t) helpDialog.scrollTo({ top: t.offsetTop - helpBody.querySelector('.htoc').offsetHeight - 64, behavior: 'smooth' });
    }));
  }
  function openHelp() {
    buildHelp(); // 開くたびに作り直す（「いまここ」を最新に）
    helpDialog.showModal();
    helpDialog.scrollTop = 0;
  }
  document.getElementById('help-close').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('click', e => { if (e.target === helpDialog) helpDialog.close(); });
  document.getElementById('help-feedback').addEventListener('click', () => {
    helpDialog.close();
    syncFocusFeedback = true;
    switchTab('sync');
  });

  updateBadges();
  switchTab('home');
  maybeOnboard();
  S.pingDevice();
  // Firebase から公式問題の最新リストを取得できたら表示を更新（設定シートや入力中の画面は崩さない）
  S.ready.then(() => {
    tagFreq = null;
    updateBadges();
    if (setup) return;
    if (document.body.classList.contains('insession')) {
      if (currentTab === 'home' && S.raw().session) renderPractice(); // 途中のセッションは最新の問題リストで描き直す
      return; // 結果画面・復習の途中はそのまま
    }
    if (currentTab === 'home' || currentTab === 'stats' || currentTab === 'me' || currentTab === 'review') renderers[currentTab]();
    else if (currentTab === 'library') renderLibList();
  });

  /* ---------- PWA ----------
     ローカル開発（localhost / file:）ではキャッシュの混乱を避けるため登録しない。 */
  if ('serviceWorker' in navigator) {
    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || location.protocol === 'file:';
    if (!isLocal) {
      window.addEventListener('load', () =>
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
    }
  }
})();
