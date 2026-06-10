/* =========================================================
   ChemFlash アプリ本体
   タブ: 演習 / 復習 / 書庫 / 分析 / 保存 / 同期
   ========================================================= */
'use strict';

(() => {
  const view = document.getElementById('view');
  const S = ChemStore;

  /* ---------- 汎用 ---------- */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
  const stars = d => '★'.repeat(d) + '☆'.repeat(3 - d);
  // 理解度 0→赤 / 0.5→黄 / 1→緑
  const colorFor = v => v == null ? 'var(--line)' : `hsl(${Math.round(v * 130)} 62% 46%)`;

  /* ---------- 問題カード ---------- */
  function tagsHTML(q) {
    return q.tags ? q.tags.split(' ').filter(Boolean)
      .map(t => `<button class="tagbtn" data-tag="${esc(t)}">#${esc(t)}</button>`).join('') : '';
  }

  function cardHTML(q, opts = {}) {
    const comment = S.commentOf(q.id);
    return `
    <section class="panel qcard" data-qid="${esc(q.id)}">
      <div class="qcard-top">
        <span class="chip unit">${esc(q.unit)}</span>
        <span class="chip sub">${esc(q.sub_unit)}</span>
        <span class="chip type-${esc(q.question_type)}">${esc(q.question_type)}</span>
        <span class="diff" title="難易度">${stars(q.difficulty)}</span>
        <button class="star-btn ${S.isBookmarked(q.id) ? 'on' : ''}" data-act="star" title="大事な問題として保存">${S.isBookmarked(q.id) ? '★' : '☆'}</button>
      </div>
      <div class="qtext">${esc(q.question)}</div>
      <div class="answer-area"></div>
      <div class="reveal-wrap">
        <button class="btn primary wide" data-act="reveal">答えを見る</button>
        ${opts.showUnlearned ? `<button class="btn skip wide" data-act="unlearned" title="まだ授業で習っていない問題（統計・出題から外す）">⤳ まだ習ってない</button>` : ''}
      </div>
      <div class="comment-wrap">
        <button class="comment-toggle" data-act="comment-toggle">✎ ひとことメモ ${comment ? '（あり）' : ''}</button>
        <div class="comment-preview">${comment ? '📝 ' + esc(comment) : ''}</div>
        <div class="comment-body" hidden>
          <textarea data-role="comment" placeholder="例: 反応式ごと暗記する／模試で出た">${esc(comment)}</textarea>
          <button class="btn sm" data-act="comment-save">保存</button>
        </div>
      </div>
    </section>`;
  }

  // handlers: { onGrade(grade), onUnlearned() }
  function bindCard(root, q, handlers = {}) {
    const card = root.querySelector(`.qcard[data-qid="${CSS.escape(q.id)}"]`);
    if (!card) return;
    const onGrade = handlers.onGrade;

    card.querySelector('[data-act="reveal"]').addEventListener('click', () => {
      const tags = tagsHTML(q);
      const related = S.tagsOf(q.id).length
        ? `<button class="btn sm ghost" data-act="related">🔗 関連問題を書庫で見る</button>` : '';
      card.querySelector('.answer-area').innerHTML = `
        <div class="answer-box"><span class="label">ANSWER</span><br>${esc(q.answer)}</div>
        ${tags ? `<div class="tags ans-tags">${tags}</div>` : ''}
        ${onGrade ? `
        <p class="judge-q">どれくらい分かった？</p>
        <div class="judge-row grade3">
          <button class="btn ng" data-g="ng">🙅 わからない</button>
          <button class="btn vague" data-g="vague">🤔 あいまい</button>
          <button class="btn ok" data-g="ok">🙆 完璧</button>
        </div>` : ''}
        <div class="after-row">${related}</div>`;
      card.querySelector('.reveal-wrap').hidden = true;
      if (onGrade) {
        card.querySelectorAll('[data-g]').forEach(b =>
          b.addEventListener('click', () => onGrade(b.dataset.g)));
      }
      card.querySelectorAll('.ans-tags .tagbtn').forEach(b =>
        b.addEventListener('click', () => openLibraryWithTag(b.dataset.tag)));
      const rel = card.querySelector('[data-act="related"]');
      if (rel) rel.addEventListener('click', () => openLibraryWithTag(S.tagsOf(q.id)[0]));
    });

    const unl = card.querySelector('[data-act="unlearned"]');
    if (unl && handlers.onUnlearned) unl.addEventListener('click', handlers.onUnlearned);

    card.querySelector('[data-act="star"]').addEventListener('click', e => {
      const on = S.toggleBookmark(q.id);
      e.target.classList.toggle('on', on);
      e.target.textContent = on ? '★' : '☆';
      toast(on ? '★ 保存しました' : '保存を外しました', on ? 'good' : '');
    });

    card.querySelector('[data-act="comment-toggle"]').addEventListener('click', () => {
      const body = card.querySelector('.comment-body');
      body.hidden = !body.hidden;
      if (!body.hidden) body.querySelector('textarea').focus();
    });
    card.querySelector('[data-act="comment-save"]').addEventListener('click', () => {
      const text = card.querySelector('[data-role="comment"]').value;
      S.setComment(q.id, text);
      card.querySelector('.comment-preview').textContent = text.trim() ? '📝 ' + text.trim() : '';
      card.querySelector('.comment-body').hidden = true;
      toast('メモを保存しました', 'good');
    });
  }

  /* =========================================================
     演習モード（スタート画面 → セッション → サマリ）
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
    renderStart();
  }

  function renderStart() {
    const units = S.units(), subs = S.subUnits(), tags = S.allTags();
    const due = S.dueCount();
    view.innerHTML = `
      <section class="panel start-panel">
        <h2>🧪 演習をはじめる</h2>
        <p class="muted small">単元もタイプも混ぜて重複なく出題（インターリーブ式）。途中で「ストップ」できます。</p>
        ${due ? `<p class="due-hint">📅 今日の復習が <b>${due}</b> 問たまっています → <button class="btn sm" id="jump-review">復習へ</button></p>` : ''}
        <div class="start-grid">
          <div>
            <label>出題数</label>
            <select id="cf-size">
              <option value="10">10問</option>
              <option value="20" selected>20問</option>
              <option value="30">30問</option>
              <option value="all">全部</option>
              <option value="time">時間制（15分）</option>
            </select>
          </div>
          <div>
            <label>並び</label>
            <select id="cf-order">
              <option value="mix" selected>ミックス（混ぜる）</option>
              <option value="block">集中（単元ごと）</option>
            </select>
          </div>
          <div>
            <label>範囲</label>
            <select id="cf-kind">
              <option value="all" selected>全範囲</option>
              <option value="unit">単元で絞る</option>
              <option value="sub">分野で絞る</option>
              <option value="tag">キーワードで絞る</option>
              <option value="diff">難易度で絞る</option>
            </select>
          </div>
          <div id="cf-value-wrap" hidden>
            <label>　</label>
            <select id="cf-value"></select>
          </div>
          <div class="full">
            <label>対象</label>
            <div class="seg">
              <label><input type="radio" name="cf-target" value="new" checked> 未着手優先</label>
              <label><input type="radio" name="cf-target" value="all"> 全部</label>
              <label><input type="radio" name="cf-target" value="weak"> 苦手だけ</label>
            </div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn primary big" id="start-btn">スタート！ ▶</button>
        </div>
        <p class="muted small">通算 ${S.raw().totalCycles || 0} 周 / 🎓定着 ${S.graduatedCount()} 問</p>
      </section>`;

    const kindSel = document.getElementById('cf-kind');
    const valWrap = document.getElementById('cf-value-wrap');
    const valSel = document.getElementById('cf-value');
    const fillValues = () => {
      const k = kindSel.value;
      if (k === 'all') { valWrap.hidden = true; return; }
      valWrap.hidden = false;
      let opts = [];
      if (k === 'unit') opts = units;
      else if (k === 'sub') opts = subs;
      else if (k === 'tag') opts = tags;
      else if (k === 'diff') opts = ['1', '2', '3'];
      valSel.innerHTML = opts.map(o => `<option value="${esc(o)}">${esc(k === 'diff' ? o + '（' + stars(+o) + '）' : o)}</option>`).join('');
    };
    kindSel.addEventListener('change', fillValues);
    fillValues();

    const jr = document.getElementById('jump-review');
    if (jr) jr.addEventListener('click', () => switchTab('review'));

    document.getElementById('start-btn').addEventListener('click', () => {
      const kind = kindSel.value;
      const config = {
        size: document.getElementById('cf-size').value,
        order: document.getElementById('cf-order').value,
        scope: { kind, value: kind === 'all' ? '' : valSel.value },
        target: document.querySelector('input[name="cf-target"]:checked').value,
      };
      startSession(config);
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
      return;
    }
    lastConfig = config;
    S.raw().session = {
      config, order, pos: 0, stopped: false,
      counts: { ok: 0, vague: 0, ng: 0, unlearned: 0 },
      startedAt: Date.now(),
      endsAt: config.size === 'time' ? Date.now() + 15 * 60000 : null,
    };
    S.persistLocal();
    renderSessionCard();
  }

  function renderSessionCard() {
    const s = S.raw().session;
    if (s.endsAt && Date.now() > s.endsAt) { s.stopped = true; S.persistLocal(); renderSummary(); return; }

    const q = S.byId(s.order[s.pos]);
    if (!q) { s.pos++; S.persistLocal(); renderPractice(); return; }

    const progress = s.order.length ? s.pos / s.order.length : 0;
    const timeLeft = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - Date.now()) / 60000)) : null;
    view.innerHTML = `
      <div class="session-bar">
        <button class="btn sm danger" id="stop-btn">■ ストップ</button>
        <div class="progress-track"><div class="progress-fill" style="width:${progress * 100}%"></div></div>
        <span class="meta">${s.endsAt ? '残り約' + timeLeft + '分' : (s.pos + 1) + ' / ' + s.order.length + ' 問'}</span>
      </div>
      ${cardHTML(q, { showUnlearned: true })}`;

    document.getElementById('stop-btn').addEventListener('click', () => {
      s.stopped = true; S.persistLocal(); renderSummary();
    });

    bindCard(view, q, {
      onGrade: grade => {
        S.recordAnswer(q.id, grade);
        s.counts[grade]++;
        s.pos++;
        S.persistLocal();
        const msg = { ok: '完璧！ 🙆', vague: '復習リストへ 🤔', ng: '復習リストへ 📌' }[grade];
        toast(msg, grade === 'ok' ? 'good' : '');
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
  }

  function renderSummary() {
    const s = S.raw().session;
    const c = s.counts;
    const done = c.ok + c.vague + c.ng;
    const full = !s.stopped && s.config.size === 'all' && s.config.scope.kind === 'all' && s.config.target !== 'weak';
    if (full && done > 0) { S.raw().totalCycles = (S.raw().totalCycles || 0) + 1; }
    S.raw().session = null;
    S.persistLocal();

    view.innerHTML = `
      <section class="panel center">
        <div class="done-emoji">🧪🎉</div>
        <h2>${s.stopped ? 'おつかれさま！' : 'セッション完了！'}</h2>
        <p class="score-line">
          🙆完璧 <b class="okc">${c.ok}</b> ／ 🤔あいまい <b style="color:var(--yellow)">${c.vague}</b> ／ 🙅わからない <b class="ngc">${c.ng}</b>
          ${done ? `<br><span class="muted small">完璧率 ${Math.round(c.ok / done * 100)}% ・ ${done}問</span>` : ''}
        </p>
        <div class="btn-row" style="justify-content:center">
          <button class="btn primary" id="again-btn">もう一回（同じ条件）</button>
          <button class="btn" id="home-btn">設定を変える</button>
          ${(c.vague + c.ng) ? `<button class="btn" id="to-review">復習する →</button>` : ''}
        </div>
      </section>`;
    document.getElementById('again-btn').addEventListener('click', () => startSession(s.config));
    document.getElementById('home-btn').addEventListener('click', renderStart);
    const tr = document.getElementById('to-review');
    if (tr) tr.addEventListener('click', () => switchTab('review'));
  }

  /* =========================================================
     復習モード（🔁間違い復習 / 📅今日の復習）
     ========================================================= */
  const reviewState = { mode: 'wrong', sub: '', type: '', pool: null };

  function buildReviewPool() {
    const ids = reviewState.mode === 'due'
      ? S.dueTodayIds(reviewState.sub, reviewState.type)
      : S.reviewWrongIds(reviewState.sub, reviewState.type);
    reviewState.pool = shuffle(ids);
  }

  function renderReview() {
    if (!S.questions().length) { renderEmpty(); return; }
    if (reviewState.pool === null) buildReviewPool();

    const wrongN = S.reviewWrongIds().length;
    const dueN = S.dueTodayIds().length;
    const subOptions = S.subUnits().map(s =>
      `<option value="${esc(s)}" ${reviewState.sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const typeOptions = S.TYPES.map(t =>
      `<option value="${esc(t)}" ${reviewState.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('');

    const head = `
      <div class="subtabs">
        <button class="subtab ${reviewState.mode === 'wrong' ? 'active' : ''}" data-mode="wrong">🔁 間違い復習 <span class="cnt">${wrongN}</span></button>
        <button class="subtab ${reviewState.mode === 'due' ? 'active' : ''}" data-mode="due">📅 今日の復習 <span class="cnt">${dueN}</span></button>
      </div>
      <p class="muted small">${reviewState.mode === 'wrong'
        ? '「完璧」以外（わからない・あいまい）の問題を今すぐ反復。完璧にすると外れます。'
        : '忘却曲線にそって「そろそろ忘れる頃」の問題が出ます。完璧で間隔が伸び、2回こなすと🎓定着。'}</p>
      <div class="filter-row">
        <select id="rv-sub"><option value="">すべての分野</option>${subOptions}</select>
        <select id="rv-type"><option value="">すべてのタイプ</option>${typeOptions}</select>
      </div>`;

    if (!reviewState.pool.length) {
      view.innerHTML = `${head}
        <section class="panel center">
          <div class="done-emoji">${reviewState.mode === 'due' ? '☕' : '✨'}</div>
          <h2>${reviewState.mode === 'due' ? '今日の復習はありません' : 'この条件の復習はありません'}</h2>
          <p class="muted">${reviewState.mode === 'due'
            ? 'また期限が来たら自動で出てきます。演習を進めましょう。'
            : '演習で「あいまい」「わからない」を選んだ問題がここに溜まります。'}</p>
        </section>`;
      bindReviewControls();
      return;
    }

    const q = S.byId(reviewState.pool[0]);
    view.innerHTML = `${head}
      <div class="session-bar"><span class="meta">残り <b>${reviewState.pool.length}</b> 問</span></div>
      ${cardHTML(q)}`;
    bindReviewControls();

    bindCard(view, q, {
      onGrade: grade => {
        S.recordAnswer(q.id, grade);
        reviewState.pool.shift();
        if (reviewState.mode === 'wrong' && grade !== 'ok') reviewState.pool.push(q.id);
        const msg = grade === 'ok' ? '完璧！ 🎓' : (grade === 'vague' ? 'もう一度あとで 🤔' : 'もう一度あとで 📌');
        toast(msg, grade === 'ok' ? 'good' : '');
        updateBadges();
        renderReview();
      },
    });
  }

  function bindReviewControls() {
    view.querySelectorAll('.subtab').forEach(b => b.addEventListener('click', () => {
      reviewState.mode = b.dataset.mode; reviewState.pool = null; renderReview();
    }));
    document.getElementById('rv-sub').addEventListener('change', e => {
      reviewState.sub = e.target.value; buildReviewPool(); renderReview();
    });
    document.getElementById('rv-type').addEventListener('change', e => {
      reviewState.type = e.target.value; buildReviewPool(); renderReview();
    });
  }

  /* =========================================================
     書庫（採点なし・検索/フィルタ）
     ========================================================= */
  const libState = { search: '', sub: '', type: '', diff: '', tag: '', status: '' };
  let pendingTag = null;

  function openLibraryWithTag(tag) {
    pendingTag = tag || '';
    switchTab('library');
  }

  const STATUS_FILTERS = [
    ['', 'すべての状態'], ['untouched', '未着手'], ['ng', 'わからない'],
    ['vague', 'あいまい'], ['ok', '完璧'], ['graduated', '🎓定着'], ['unlearned', '未習'],
  ];

  function renderLibrary() {
    if (pendingTag !== null) { libState.tag = pendingTag; pendingTag = null; }
    if (!S.questions().length) { renderEmpty(); return; }

    const subOpt = ['<option value="">すべての分野</option>'].concat(
      S.subUnits().map(s => `<option value="${esc(s)}" ${libState.sub === s ? 'selected' : ''}>${esc(s)}</option>`)).join('');
    const typeOpt = ['<option value="">すべてのタイプ</option>'].concat(
      S.TYPES.map(t => `<option ${libState.type === t ? 'selected' : ''}>${esc(t)}</option>`)).join('');
    const diffOpt = ['<option value="">難易度すべて</option>'].concat(
      ['1', '2', '3'].map(d => `<option value="${d}" ${libState.diff === d ? 'selected' : ''}>${stars(+d)}</option>`)).join('');
    const statusOpt = STATUS_FILTERS.map(([v, l]) =>
      `<option value="${v}" ${libState.status === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

    const t = libState.search.toLowerCase();
    const list = S.questions().filter(q => {
      const si = S.statusInfo(q.id);
      return (!libState.sub || q.sub_unit === libState.sub)
        && (!libState.type || q.question_type === libState.type)
        && (!libState.diff || String(q.difficulty) === libState.diff)
        && (!libState.tag || (' ' + q.tags + ' ').includes(' ' + libState.tag + ' '))
        && (!libState.status || si.key === libState.status)
        && (!t || (q.question + ' ' + q.answer + ' ' + q.tags).toLowerCase().includes(t));
    });

    view.innerHTML = `
      <section class="panel">
        <h2>📖 書庫 <span class="muted" id="lib-count">（${list.length}問）</span></h2>
        <p class="muted small">読むだけ・採点なし。テスト前の総ざらいに。タップで答え表示。</p>
        ${libState.tag ? `<p class="active-tag">絞り込み中: <span class="chip sub">#${esc(libState.tag)}</span> <button class="btn sm" id="clear-tag">解除</button></p>` : ''}
        <input type="text" id="lib-search" placeholder="🔍 問題文・答え・キーワードで検索" value="${esc(libState.search)}" style="width:100%;margin-bottom:10px">
        <div class="filter-row">
          <select id="lib-sub">${subOpt}</select>
          <select id="lib-type">${typeOpt}</select>
          <select id="lib-diff">${diffOpt}</select>
          <select id="lib-status">${statusOpt}</select>
        </div>
        <div class="lib-list">
          ${list.map(q => {
            const si = S.statusInfo(q.id);
            const c = S.commentOf(q.id);
            return `
            <details class="lib-item" data-qid="${esc(q.id)}">
              <summary>
                <span class="badge b-${si.key}">${esc(si.label)}</span>
                <span class="lib-q">${esc(q.question)}</span>
              </summary>
              <div class="lib-body">
                <div class="lib-meta">
                  <span class="chip sub">${esc(q.sub_unit)}</span>
                  <span class="chip type-${esc(q.question_type)}">${esc(q.question_type)}</span>
                  <span class="diff">${stars(q.difficulty)}</span>
                  <button class="star-btn ${S.isBookmarked(q.id) ? 'on' : ''}" data-act="star">${S.isBookmarked(q.id) ? '★' : '☆'}</button>
                </div>
                <div class="answer-box"><span class="label">ANSWER</span><br>${esc(q.answer)}</div>
                ${q.tags ? `<div class="tags">${q.tags.split(' ').filter(Boolean).map(tg => `<button class="tagbtn" data-tag="${esc(tg)}">#${esc(tg)}</button>`).join('')}</div>` : ''}
                ${c ? `<p class="comment-preview">📝 ${esc(c)}</p>` : ''}
                <div class="btn-row">
                  <button class="btn sm ${S.isUnlearned(q.id) ? 'primary' : ''}" data-act="unlearned">${S.isUnlearned(q.id) ? '↺ 未習を解除' : '⤳ 未習にする'}</button>
                </div>
              </div>
            </details>`;
          }).join('') || '<p class="muted center">該当する問題がありません</p>'}
        </div>
      </section>`;

    const reRender = () => renderLibrary();
    const si = document.getElementById('lib-search');
    si.addEventListener('input', e => { libState.search = e.target.value; updateLibList(); });
    document.getElementById('lib-sub').addEventListener('change', e => { libState.sub = e.target.value; reRender(); });
    document.getElementById('lib-type').addEventListener('change', e => { libState.type = e.target.value; reRender(); });
    document.getElementById('lib-diff').addEventListener('change', e => { libState.diff = e.target.value; reRender(); });
    document.getElementById('lib-status').addEventListener('change', e => { libState.status = e.target.value; reRender(); });
    const ct = document.getElementById('clear-tag');
    if (ct) ct.addEventListener('click', () => { libState.tag = ''; reRender(); });

    view.querySelectorAll('.tagbtn').forEach(b =>
      b.addEventListener('click', e => { e.preventDefault(); libState.tag = b.dataset.tag; reRender(); }));
    view.querySelectorAll('.lib-item [data-act="star"]').forEach(b =>
      b.addEventListener('click', e => {
        const id = b.closest('.lib-item').dataset.qid;
        const on = S.toggleBookmark(id);
        b.classList.toggle('on', on); b.textContent = on ? '★' : '☆';
      }));
    view.querySelectorAll('.lib-item [data-act="unlearned"]').forEach(b =>
      b.addEventListener('click', () => {
        const id = b.closest('.lib-item').dataset.qid;
        S.setUnlearned(id, !S.isUnlearned(id));
        toast(S.isUnlearned(id) ? '未習にしました' : '未習を解除しました');
        reRender();
      }));
  }

  // 検索だけは件数表示の軽量更新（details開閉を保つため全再描画しない）
  function updateLibList() { renderLibrary(); }

  /* =========================================================
     分析（ヒートマップ + ドリルダウン）
     ========================================================= */
  const statsState = { expandedUnit: null };

  function stackedBar(m, kind) {
    // kind: 'understand'（statusBreak） or 'first'（firstBreak）
    const b = kind === 'first' ? m.firstBreak : m.statusBreak;
    const n = b.ok + b.vague + b.ng;
    const seg = (cls, v) => v ? `<span class="seg ${cls}" style="width:${v / n * 100}%"></span>` : '';
    const headline = kind === 'first' ? m.firstRate : m.understanding;
    return `
      <div class="bar-line">
        <span class="blabel">${kind === 'first' ? '初回正答率' : '理解度'}</span>
        <div class="bar-track stacked">${n ? seg('s-ok', b.ok) + seg('s-vague', b.vague) + seg('s-ng', b.ng) : ''}</div>
        <span class="bval">${pct(headline)}</span>
      </div>`;
  }

  function coverageBar(m) {
    return `
      <div class="bar-line">
        <span class="blabel">カバー率</span>
        <div class="bar-track"><div class="bar-fill coverage" style="width:${m.coverage * 100}%"></div></div>
        <span class="bval">${pct(m.coverage)}</span>
      </div>`;
  }

  function statBlock(name, m, count = true) {
    return `
      <div class="stat-row">
        <span class="name">${esc(name)}</span>
        ${count ? `<span class="count">${m.attempted}/${m.total}問${m.graduated ? ' ・🎓' + m.graduated : ''}</span>` : ''}
        <div class="bars">
          ${stackedBar(m, 'understand')}
          ${stackedBar(m, 'first')}
          ${coverageBar(m)}
        </div>
      </div>`;
  }

  function renderStats() {
    if (!S.questions().length) { renderEmpty(); return; }
    const overall = S.metrics();

    // 弱点トップ3（解いたことのある sub_unit を理解度の低い順に）
    const subStats = S.subUnits().map(su => [su, S.metrics(q => q.sub_unit === su)])
      .filter(([, m]) => m.attempted > 0)
      .sort((a, b) => (a[1].understanding ?? 1) - (b[1].understanding ?? 1));
    const weak3 = subStats.slice(0, 3);

    // 単元タイル
    const unitTiles = S.units().map(u => {
      const m = S.metrics(q => q.unit === u);
      return `<button class="unit-tile ${statsState.expandedUnit === u ? 'open' : ''}" data-unit="${esc(u)}"
        style="--c:${colorFor(m.understanding)}">
        <span class="ut-name">${esc(u)}</span>
        <span class="ut-val">${pct(m.understanding)}</span>
        <span class="ut-sub">理解度 ・ ${m.attempted}/${m.total}問</span>
      </button>`;
    }).join('');

    // ドリルダウン（選択中の単元の sub_unit 別）
    let drill = '';
    if (statsState.expandedUnit) {
      const subs = S.subUnitsOfUnit(statsState.expandedUnit);
      drill = `<section class="panel">
        <h2><span class="accent">${esc(statsState.expandedUnit)}</span> の分野別</h2>
        ${subs.map(su => statBlock(su, S.metrics(q => q.unit === statsState.expandedUnit && q.sub_unit === su))).join('')}
      </section>`;
    }

    // タグ別弱点（n>=3、理解度の低い順 上位10）
    const tagWeak = S.tagMetrics().filter(t => t.attempted >= 3)
      .sort((a, b) => (a.understanding ?? 1) - (b.understanding ?? 1)).slice(0, 10);

    view.innerHTML = `
      <section class="panel hero">
        <div class="hero-stats">
          <div class="hs"><b style="color:var(--green)">${overall.graduated}</b><span>🎓 定着</span></div>
          <div class="hs"><b style="color:var(--cyan)">${S.dueCount()}</b><span>📅 今日の復習</span></div>
          <div class="hs"><b style="color:var(--violet)">${pct(overall.coverage)}</b><span>カバー率</span></div>
        </div>
        ${weak3.length ? `
        <div class="weak-box">
          <div class="weak-title">⚠ いま優先したい分野</div>
          <ol class="weak-list">
            ${weak3.map(([su, m]) => `<li><span class="dot" style="background:${colorFor(m.understanding)}"></span>${esc(su)} <b>${pct(m.understanding)}</b> <span class="muted small">(${m.attempted}問)</span></li>`).join('')}
          </ol>
        </div>` : '<p class="muted small">まだ解いた問題が少ないです。演習を進めると弱点が見えてきます。</p>'}
      </section>

      <section class="panel">
        <h2>📊 単元別（タップで詳細）</h2>
        <div class="metric-legend">
          <span><i class="sw s-ok"></i>完璧</span><span><i class="sw s-vague"></i>あいまい</span><span><i class="sw s-ng"></i>わからない</span>
        </div>
        <div class="unit-grid">${unitTiles}</div>
      </section>
      ${drill}

      <section class="panel">
        <h2>🔑 キーワード別の弱点 <span class="muted small">（3問以上解いたタグ）</span></h2>
        ${tagWeak.length ? `<div class="bars">${tagWeak.map(t => `
          <div class="bar-line">
            <button class="blabel tagbtn" data-tag="${esc(t.tag)}" style="text-align:left">#${esc(t.tag)}</button>
            <div class="bar-track stacked">
              <span class="seg s-ok" style="width:${t.statusBreak.ok / t.attempted * 100}%"></span>
              <span class="seg s-vague" style="width:${t.statusBreak.vague / t.attempted * 100}%"></span>
              <span class="seg s-ng" style="width:${t.statusBreak.ng / t.attempted * 100}%"></span>
            </div>
            <span class="bval">${pct(t.understanding)}</span>
          </div>`).join('')}</div>`
        : '<p class="muted small">まだデータがありません。</p>'}
      </section>

      <section class="panel">
        <h2>📐 問題タイプ別</h2>
        ${S.TYPES.map(t => statBlock(t, S.metrics(q => q.question_type === t))).join('')}
      </section>`;

    view.querySelectorAll('.unit-tile').forEach(b => b.addEventListener('click', () => {
      const u = b.dataset.unit;
      statsState.expandedUnit = statsState.expandedUnit === u ? null : u;
      renderStats();
    }));
    view.querySelectorAll('.tagbtn').forEach(b =>
      b.addEventListener('click', () => openLibraryWithTag(b.dataset.tag)));
  }

  /* =========================================================
     保存した問題
     ========================================================= */
  function renderSaved() {
    const saved = S.raw().bookmarks.map(id => S.byId(id)).filter(Boolean);
    if (!saved.length) {
      view.innerHTML = `
        <section class="panel center">
          <div class="done-emoji">⭐</div>
          <h2>保存した問題はまだありません</h2>
          <p class="muted">問題カード右上の ☆ を押すと、大事な問題をここにストックできます。</p>
        </section>`;
      return;
    }
    view.innerHTML = `
      <section class="panel">
        <h2>⭐ 保存した問題 <span class="muted">（${saved.length}問）</span></h2>
        ${saved.map(q => {
          const c = S.commentOf(q.id);
          return `
          <details class="saved-item" data-qid="${esc(q.id)}">
            <summary>
              <span>${esc(q.question)}</span>
              <span class="chip sub">${esc(q.sub_unit)}</span>
              <span class="chip type-${esc(q.question_type)}">${esc(q.question_type)}</span>
            </summary>
            <div class="saved-body">
              <div class="answer-box"><span class="label">ANSWER</span><br>${esc(q.answer)}</div>
              ${c ? `<p class="comment-preview">📝 ${esc(c)}</p>` : ''}
              <div class="btn-row">
                <button class="btn sm danger" data-act="unstar">★ 保存から外す</button>
              </div>
            </div>
          </details>`;
        }).join('')}
      </section>`;
    view.querySelectorAll('[data-act="unstar"]').forEach(btn => {
      btn.addEventListener('click', () => {
        S.toggleBookmark(btn.closest('details').dataset.qid);
        toast('保存から外しました');
        renderSaved();
      });
    });
  }

  /* =========================================================
     同期
     ========================================================= */
  function renderSync() {
    const d = S.raw();
    const configured = !!S.dbUrl();
    const last = d.lastSync ? new Date(d.lastSync).toLocaleString('ja-JP') : 'まだ同期していません';

    const cloudHTML = configured ? `
      <section class="panel">
        <h2>☁ クラウド同期 <span class="accent">同期ID</span></h2>
        <p class="muted">ログイン不要。「同期ID」を発行すると学習データがクラウドに保存され、別の端末でIDを入力すれば続きから学習できます。</p>
        ${d.syncId ? `
          <p class="small muted">あなたの同期ID（他の端末でこのIDを入力して復元）:</p>
          <div class="sync-id-box" id="sync-id-text">${esc(d.syncId)}</div>
          <div class="btn-row">
            <button class="btn sm" id="copy-id">📋 IDをコピー</button>
            <button class="btn sm primary" id="push-now">☁ 今すぐクラウドに保存</button>
          </div>
          <p class="small muted">最終同期: ${esc(last)}<br>※ 同期ID設定中はデータ変更の数秒後に自動でクラウド保存されます。</p>
        ` : `
          <div class="btn-row">
            <button class="btn primary" id="create-id">🔑 新しい同期IDを発行する</button>
          </div>
        `}
      </section>
      <section class="panel">
        <h2>📥 同期IDから復元</h2>
        <p class="muted small">⚠ この端末のデータはクラウド側の内容で<strong>上書き</strong>されます。</p>
        <div class="btn-row">
          <input type="text" id="pull-id" placeholder="例: CF-XXXX-XXXX-XXXX" style="flex:1;min-width:200px">
          <button class="btn" id="pull-btn">復元する</button>
        </div>
        <p class="muted small">同期IDは合言葉のようなものです。IDを知っていれば誰でもデータを見られるため、メモ欄に個人情報は書かないでください。</p>
      </section>` : `
      <section class="panel">
        <h2>☁ クラウド同期（未設定）</h2>
        <p class="muted small">クラウド同期を使うには、無料の Firebase Realtime Database を一度だけ用意して、そのURLをここに設定します。手順は <b>js/sync-config.js</b> のコメント、または README に書いてあります（約5分・カード不要）。設定するまでは下の「ファイルでバックアップ」で端末間の引っ越しができます。</p>
        <div class="btn-row">
          <input type="text" id="db-url" placeholder="https://xxxx-default-rtdb.....firebasedatabase.app" style="flex:1;min-width:220px">
          <button class="btn primary" id="db-save">接続テストして保存</button>
        </div>
      </section>`;

    view.innerHTML = `
      ${cloudHTML}
      <section class="panel">
        <h2>💾 ファイルでバックアップ / 復元</h2>
        <p class="muted small">サーバ不要。バックアップファイルを書き出して、別の端末で読み込めばそのまま引き継げます。</p>
        <div class="btn-row">
          <button class="btn" id="backup-btn">⬇ バックアップを書き出す</button>
          <label class="btn" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">
            📂 バックアップを読み込む<input type="file" id="restore-file" accept=".json,application/json" hidden>
          </label>
        </div>
      </section>
      ${configured ? `
      <section class="panel">
        <p class="muted small">同期先: <span style="font-family:var(--mono)">${esc(S.dbUrl())}</span>
        <button class="btn sm" id="db-change" style="margin-left:8px">変更</button></p>
      </section>` : ''}`;

    const busy = (btn, label) => { btn.disabled = true; btn.textContent = label; };

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
        toast('同期サーバを設定しました ✔', 'good');
      } catch (e) { toast(e.message === 'Failed to fetch' ? 'URLに接続できませんでした' : e.message, 'bad'); }
      renderSync();
    });

    const dbChange = document.getElementById('db-change');
    if (dbChange) dbChange.addEventListener('click', () => { S.setDbUrl(''); renderSync(); });

    const createBtn = document.getElementById('create-id');
    if (createBtn) createBtn.addEventListener('click', async () => {
      busy(createBtn, '発行中…');
      try { await S.syncCreate(); toast('同期IDを発行しました 🔑', 'good'); }
      catch (e) { toast(e.message, 'bad'); }
      renderSync();
    });

    const copyBtn = document.getElementById('copy-id');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.syncId); toast('コピーしました 📋', 'good'); }
      catch { toast('コピーできませんでした。長押し/選択でコピーしてください', 'bad'); }
    });

    const pushBtn = document.getElementById('push-now');
    if (pushBtn) pushBtn.addEventListener('click', async () => {
      busy(pushBtn, '保存中…');
      try { await S.syncPush(); toast('クラウドに保存しました ☁', 'good'); }
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
        reviewState.pool = null;
        toast('復元しました ✔', 'good');
        switchTab('practice');
      } catch (e) { toast(e.message, 'bad'); }
    });

    document.getElementById('backup-btn').addEventListener('click', () => {
      const blob = new Blob([S.exportBackup()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chemflash_backup_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('バックアップを書き出しました ⬇', 'good');
    });

    document.getElementById('restore-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('この端末のデータをバックアップファイルの内容で上書きします。よろしいですか？')) { e.target.value = ''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          S.importBackup(String(reader.result));
          reviewState.pool = null;
          toast('復元しました ✔', 'good');
          switchTab('practice');
        } catch (err) { toast(err.message, 'bad'); }
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
  }

  /* ---------- 問題ゼロ ---------- */
  function renderEmpty() {
    view.innerHTML = `
      <section class="panel center">
        <div class="done-emoji">⚗️</div>
        <h2>問題がまだ登録されていません</h2>
        <p class="muted">管理画面からCSVで問題を追加してください。</p>
        <a class="btn primary" href="admin.html" style="display:inline-block;text-decoration:none">🛠 問題管理画面を開く</a>
      </section>`;
  }

  /* ---------- ナビ ---------- */
  function updateBadges() {
    const due = S.dueCount();
    const wrong = S.reviewWrongIds().length;
    const btn = document.querySelector('nav.tabs button[data-tab="review"]');
    if (btn) {
      const n = due + wrong;
      btn.innerHTML = '📌 復習' + (n ? ` <span class="navbadge">${n}</span>` : '');
    }
  }

  const renderers = {
    practice: renderPractice,
    review: renderReview,
    library: renderLibrary,
    stats: renderStats,
    saved: renderSaved,
    sync: renderSync,
  };

  function switchTab(name) {
    document.querySelectorAll('nav.tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'review') reviewState.pool = null;
    updateBadges();
    (renderers[name] || renderPractice)();
  }
  window.switchTab = switchTab;

  document.querySelectorAll('nav.tabs button').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  updateBadges();
  switchTab('practice');

  /* ---------- PWA ----------
     ローカル開発（localhost / file:）ではキャッシュの混乱を避けるため登録しない。
     公開ドメインに置いたときだけオフライン対応・ホーム追加が有効になる。 */
  if ('serviceWorker' in navigator) {
    const host = location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || location.protocol === 'file:';
    if (!isLocal) {
      window.addEventListener('load', () =>
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e)));
    }
  }
})();
