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

  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';

  /* ---------- 見た目の設定（学習データとは別のキー） ---------- */
  const ui = (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } })();
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 保存できなくても動く */ } };

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
        <div class="fq"><span class="qno">Q.${String(opts.qno).padStart(2, '0')}</span><div class="qtext">${esc(q.question)}</div>${memoView(q)}</div>
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
  let lastConfig = null;

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
    const due = S.dueCount();
    const wrong = S.reviewWrongIds().length;
    const quest = due ? { tag: 'DAILY QUEST', label: '今日の復習', n: due, color: '#45e3cf', act: 'due' }
      : wrong ? { tag: 'QUEST', label: '間違い復習', n: wrong, color: '#fb923c', act: 'wrong' }
      : { tag: 'QUEST', label: '演習をはじめる', n: 20, color: '#4cc9f0', act: 'setup' };
    const active = S.questions().filter(q => !S.isUnlearned(q.id)).length;
    view.innerHTML = `${brandbar()}${levelBar()}
      <div class="body">
        <button class="quest" data-act="quest" aria-label="${quest.label}をはじめる"><div class="fl">${LAB.flask({ layers: [[quest.color, .55]], glow: quest.color, bubbles: true })}</div>
          <div class="qtx"><div class="tagq">${quest.tag}</div><span class="label">${quest.label}</span><div class="num">${quest.n}<small>問</small></div></div>
          <span class="play">${I('play')}</span></button>
        <div class="card mol"><div class="head"><span class="label">単元</span><button class="r" data-go="stats"><b>${S.graduatedCount()}</b>/ ${active} 定着${I('chev', 's14')}</button></div>${LAB.molecule(unitAtoms(), null)}</div>
        <div class="quick">
          <button class="u1" data-act="setup"><span class="ib">${I('tube')}</span>演習</button>
          <button class="u4" data-act="weak"><span class="ib">${I('target')}</span>苦手だけ</button>
          <button class="u2" data-act="timed"><span class="ib">${I('timer')}</span>15分</button>
          <button class="u5" data-go="saved"><span class="ib">${I('star')}</span>保存</button>
        </div>
        ${routeHome()}
      </div>`;
    view.querySelector('[data-act="quest"]').addEventListener('click', () => {
      if (quest.act === 'setup') openSetup(); else { switchTab('review'); startReview(quest.act); }
    });
    view.querySelector('[data-act="setup"]').addEventListener('click', () => openSetup());
    view.querySelector('[data-act="weak"]').addEventListener('click', () =>
      startSession({ size: '20', order: 'mix', scope: { kind: 'all', value: '' }, target: 'weak' }));
    view.querySelector('[data-act="timed"]').addEventListener('click', () =>
      startSession({ size: 'time', order: 'mix', scope: { kind: 'all', value: '' }, target: 'new' }));
    bindAtoms(u => { statsState.expandedUnit = u; switchTab('stats'); });
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
    setup = { size: c.size, order: c.order, kind: c.scope.kind, value: c.scope.value, target: c.target };
    renderSetup();
  }
  function closeSetup() { sheetRoot.innerHTML = ''; setup = null; }

  function scopeLabel() {
    if (setup.kind === 'unit') return unitMeta(setup.value).short + 'で';
    if (setup.kind === 'sub') return setup.value + 'で';
    if (setup.kind === 'tag') return '#' + setup.value + 'で';
    if (setup.kind === 'diff') return '難易度' + setup.value + 'で';
    return '';
  }

  function renderSetup() {
    const sizes = [['10', .25], ['20', .5], ['30', .75], ['all', 1]];
    const units = orderedUnits();
    const kindValues = setup.kind === 'sub' ? S.subUnits() : setup.kind === 'tag' ? S.allTags().sort((a, b) => a.localeCompare(b, 'ja')) : setup.kind === 'diff' ? ['1', '2', '3'] : null;
    if (kindValues && !kindValues.includes(setup.value)) setup.value = kindValues[0] || '';
    const sizeLabel = setup.size === 'time' ? '15分' : setup.size === 'all' ? '全部' : setup.size + '問';
    sheetRoot.innerHTML = `<div class="dim" data-act="close"></div>
      <div class="sheet" role="dialog" aria-label="演習の設定"><div class="handle"></div>
        <div class="sh"><h2>演習</h2><button class="iconbtn" data-act="close" aria-label="閉じる">${I('x', 's18')}</button></div>
        <div><div class="label" style="margin-bottom:7px">出題数</div><div class="cnt">${sizes.map(([v, f]) => {
          const on = setup.size === v;
          return `<button class="${on ? 'on' : ''}" data-size="${v}">${LAB.vial([[on ? '#4cc9f0' : 'rgba(76,201,240,.55)', f]], on ? '#4cc9f0' : null)}${v === 'all' ? '<small>全部</small>' : v}</button>`;
        }).join('')}<button class="${setup.size === 'time' ? 'on' : ''}" data-size="time"><span class="tm">${I('timer')}</span><small>15分</small></button></div></div>
        <div><div class="label" style="margin-bottom:7px">範囲</div>
          <div class="eltiles"><button class="${setup.kind === 'all' ? 'on' : ''}" style="--c:#c9d3ea" data-kind="all">全<small>すべて</small></button>${units.map(u => {
            const m = unitMeta(u);
            return `<button class="${setup.kind === 'unit' && setup.value === u ? 'on' : ''}" style="--c:${m.color}" data-unit="${esc(u)}">${esc(m.sym)}<small>${esc(m.short)}</small></button>`;
          }).join('')}</div>
          <div class="icopts"><button class="${setup.kind === 'sub' ? 'on' : ''}" data-kind="sub">${I('layers')}分野</button><button class="${setup.kind === 'tag' ? 'on' : ''}" data-kind="tag">${I('hash')}キーワード</button><button class="${setup.kind === 'diff' ? 'on' : ''}" data-kind="diff">${I('flame')}難易度</button></div>
          ${kindValues ? `<select class="valsel" id="setup-value">${kindValues.map(v => `<option value="${esc(v)}" ${v === setup.value ? 'selected' : ''}>${esc(setup.kind === 'diff' ? '難易度 ' + v : v)}</option>`).join('')}</select>` : ''}
        </div>
        <div class="seg2">
          <div><div class="label" style="margin-bottom:7px">並べ方</div><div class="seg"><button class="${setup.order === 'mix' ? 'on' : ''}" data-order="mix">${I('shuffle', 's14')}ミックス</button><button class="${setup.order === 'block' ? 'on' : ''}" data-order="block">${I('layers', 's14')}分野ごと</button></div></div>
          <div><div class="label" style="margin-bottom:7px">出す問題</div><div class="seg"><button class="${setup.target === 'new' ? 'on' : ''}" data-target="new">未着手</button><button class="${setup.target === 'all' ? 'on' : ''}" data-target="all">全部</button><button class="${setup.target === 'weak' ? 'on' : ''}" data-target="weak">苦手</button></div></div>
        </div>
        <button class="btn primary" data-act="start">${I('play', 'fillc')}${esc(scopeLabel())} ${sizeLabel} はじめる</button>
      </div>`;
    sheetRoot.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', closeSetup));
    sheetRoot.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { setup.size = b.dataset.size; renderSetup(); }));
    sheetRoot.querySelectorAll('[data-unit]').forEach(b => b.addEventListener('click', () => { setup.kind = 'unit'; setup.value = b.dataset.unit; renderSetup(); }));
    sheetRoot.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.kind;
      if (setup.kind !== k) { setup.kind = k; setup.value = ''; }
      else if (k !== 'all') { setup.kind = 'all'; setup.value = ''; }
      renderSetup();
    }));
    const vs = document.getElementById('setup-value');
    if (vs) vs.addEventListener('change', e => { setup.value = e.target.value; renderSetup(); });
    sheetRoot.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => { setup.order = b.dataset.order; renderSetup(); }));
    sheetRoot.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => { setup.target = b.dataset.target; renderSetup(); }));
    sheetRoot.querySelector('[data-act="start"]').addEventListener('click', () => {
      const config = {
        size: setup.size,
        order: setup.order,
        scope: { kind: setup.kind, value: setup.kind === 'all' ? '' : setup.value },
        target: setup.target,
      };
      if (startSession(config)) closeSetup();
    });
  }

  function buildOrder(config) {
    let ids = S.filterIds(config.scope, config.target);
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
    lastConfig = config;
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
      onGrade: grade => {
        S.recordAnswer(q.id, grade);
        s.counts[grade]++;
        s.pos++;
        S.persistLocal();
        updateBadges();
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
    const full = !s.stopped && s.config.size === 'all' && s.config.scope.kind === 'all' && s.config.target !== 'weak';
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
    const ids = reviewState.mode === 'due'
      ? S.dueTodayIds(reviewState.sub, reviewState.type)
      : S.reviewWrongIds(reviewState.sub, reviewState.type);
    reviewState.pool = shuffle(reviewState.mode === 'due' ? ids.slice(0, DUE_CAP) : ids);
  }

  function startReview(mode) {
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
      onGrade: grade => {
        S.recordAnswer(q.id, grade);
        st.pool.shift();
        st.counts[grade]++;
        st.done++;
        if (st.mode === 'wrong' && grade !== 'ok') st.pool.push(q.id);
        if (grade === 'ok') toast('完璧！', 'good');
        updateBadges();
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
    if (act.dataset.act === 'help') helpDialog.showModal();
    else if (act.dataset.act === 'route-hide') {
      e.preventDefault();
      ui.routeHideUntil = Date.now() + 7 * 86400000; // 7日間は出さない
      saveUi();
      const ad = act.closest('.rad');
      if (ad) ad.remove();
    }
  });

  /* ---------- 使い方ダイアログ ---------- */
  const helpDialog = document.getElementById('help-dialog');
  document.getElementById('help-close').addEventListener('click', () => helpDialog.close());
  helpDialog.addEventListener('click', e => { if (e.target === helpDialog) helpDialog.close(); });
  document.getElementById('help-feedback').addEventListener('click', () => {
    helpDialog.close();
    syncFocusFeedback = true;
    switchTab('sync');
  });

  updateBadges();
  switchTab('home');
  S.pingDevice();
  // Firebase から公式問題の最新リストを取得できたら表示を更新（設定シートや入力中の画面は崩さない）
  S.ready.then(() => {
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
