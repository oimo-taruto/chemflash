/* =========================================================
   ChemFlash データ層
   - localStorage への永続化
   - 同期ID（jsonblob.com）によるクラウド保存・復元
   - CSV インポート / エクスポート
   - 解答記録と分析指標の計算
   ========================================================= */
'use strict';

const ChemStore = (() => {

  const LS_KEY = 'chemflash_data_v1';
  const DEFAULT_UNIT = '無機化学';
  const TYPES = ['丸暗記', '理由型'];

  /* 評価グレード（3段階） */
  const GRADES = ['ng', 'vague', 'ok']; // わからない / あいまい / 完璧
  const GRADE_LABEL = { ng: 'わからない', vague: 'あいまい', ok: '完璧' };

  /* 忘却曲線（Leitner式）。完璧でこの日数間隔ぶん先に「今日の復習」へ。
     2回（1週間後・1ヶ月後）こなしたら🎓卒業。あいまい/わからないは最短(7日)へ。 */
  const DAY = 86400000;
  const SRS_INTERVALS = [7, 30]; // 日

  /* ---------- 公式問題（原本は js/seed.js。store.js より先に読み込むこと） ---------- */
  const SEED = ((typeof window !== 'undefined' && window.CHEMFLASH_SEED) || [])
    .map(r => ({ question: r[0], answer: r[1], unit: r[6] || DEFAULT_UNIT, sub_unit: r[2], question_type: r[3], tags: r[4], difficulty: r[5] }));

  /* ---------- ユーティリティ ---------- */
  function hashId(text) {
    let h = 5381;
    for (const ch of String(text)) h = (((h << 5) + h) + ch.codePointAt(0)) >>> 0;
    return 'q' + h.toString(36);
  }

  function normalizeQuestion(q) {
    const type = TYPES.includes(q.question_type) ? q.question_type
      : (String(q.question_type || '').includes('理由') ? '理由型' : '丸暗記');
    let diff = parseInt(q.difficulty, 10);
    if (!(diff >= 1 && diff <= 3)) diff = 2;
    return {
      id: q.id || hashId(q.question),
      question: String(q.question || '').trim(),
      answer: String(q.answer || '').trim(),
      unit: String(q.unit || '').trim() || DEFAULT_UNIT,
      sub_unit: String(q.sub_unit || '').trim() || 'その他',
      question_type: type,
      tags: String(q.tags || '').replace(/[,、]/g, ' ').replace(/\s+/g, ' ').trim(),
      difficulty: diff,
      // origin: 'official'（配布問題）| 'custom'（生徒の自作）。不明('')は起動時の同期で補完
      origin: q.origin === 'custom' ? 'custom' : (q.origin === 'official' ? 'official' : ''),
    };
  }

  /* 配布版の公式問題。SEED を書き換えて push すると、次回起動時に
     syncOfficialQuestions が全端末の公式問題を最新版へ揃える */
  const OFFICIAL = SEED.map(q => normalizeQuestion({ ...q, origin: 'official' }));

  /* ---------- 永続化 ---------- */
  let data;

  function defaultData() {
    return {
      questions: OFFICIAL.map(q => ({ ...q })),
      progress: {},   // qid -> {first, status('ng'|'vague'|'ok'), attempts, last, srs}
      comments: {},   // qid -> text
      bookmarks: [],  // [qid]
      unlearned: {},  // qid -> true（未習。統計・出題から除外）
      removedOfficial: {}, // qid -> true（端末側で削除した公式問題。同期で復活させない）
      session: null,  // 演習セッション
      totalCycles: 0, // 通算周回（全範囲セッション完走回数）
      syncId: '',
      dbUrl: '',
      lastSync: 0,
    };
  }

  // 旧データ（2値 first:bool / status:'ok'|'ng' / srsなし）を新形式へ移行
  function migrateProgress(prog) {
    const out = {};
    for (const [id, p] of Object.entries(prog || {})) {
      const np = { ...p };
      if (typeof np.first === 'boolean') np.first = np.first ? 'ok' : 'ng';
      if (np.status !== 'ok' && np.status !== 'ng' && np.status !== 'vague') {
        np.status = np.status ? 'ok' : (np.status === 'ng' ? 'ng' : np.status || null);
      }
      np.attempts = np.attempts || 0;
      np.srs = np.srs || { reps: 0, due: null, graduated: false, lastAdvDay: '' };
      out[id] = np;
    }
    return out;
  }

  function sameContent(a, b) {
    return a.question === b.question && a.answer === b.answer && a.unit === b.unit
      && a.sub_unit === b.sub_unit && a.question_type === b.question_type
      && a.tags === b.tags && a.difficulty === b.difficulty;
  }

  /* 公式問題を配布版（OFFICIAL）に同期する。push での問題更新を全端末へ届ける仕組み。
     - 公式: 追加・修正・削除を反映（id は問題文のハッシュなので、答えだけの修正は進捗を引き継ぐ）
     - 自作（origin:'custom'）: 一切触らない
     - 公式を端末側で編集したコピーは custom として残し、同じ id の公式は出さない（二重表示防止）。
       配布版が同じ内容になったら公式へ一本化する */
  function syncOfficialQuestions(d) {
    const seedById = new Map(OFFICIAL.map(q => [q.id, q]));
    const kept = [];
    const used = new Set(); // 採用済み or 端末側コピーを優先してスキップする公式id
    for (const q of d.questions) {
      const seedQ = seedById.get(q.id);
      const origin = q.origin || (seedQ ? 'official' : 'custom'); // origin の無い旧データを補完
      if (origin === 'official') {
        if (!seedQ || used.has(q.id)) continue; // 公式から削除された・重複
        kept.push({ ...seedQ }); used.add(q.id);
      } else if (seedQ && sameContent(q, seedQ)) {
        if (!used.has(q.id)) { kept.push({ ...seedQ }); used.add(q.id); } // 内容が一致 → 公式へ一本化
      } else {
        kept.push({ ...q, origin: 'custom' });
        if (seedQ) used.add(q.id); // 編集済みコピーを優先
      }
    }
    for (const q of OFFICIAL) {
      if (!used.has(q.id) && !(d.removedOfficial || {})[q.id]) kept.push({ ...q }); // 新しい公式問題
    }
    d.questions = kept;
    if (d.session && Array.isArray(d.session.order)) {
      const ids = new Set(kept.map(q => q.id));
      d.session.order = d.session.order.filter(id => ids.has(id));
    }
  }

  // 現行スキーマの演習セッションか（旧形式・壊れたものは破棄して作り直す）
  function isValidSession(s) {
    return !!(s && Array.isArray(s.order) && s.config && s.counts
      && typeof s.pos === 'number');
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        d.questions = (d.questions || []).map(normalizeQuestion);
        d.progress = migrateProgress(d.progress);
        d.comments = d.comments || {};
        d.bookmarks = d.bookmarks || [];
        d.unlearned = d.unlearned || {};
        d.removedOfficial = d.removedOfficial || {};
        d.totalCycles = d.totalCycles || 0;
        d.syncId = d.syncId || '';
        if (!isValidSession(d.session)) d.session = null; // 旧形式セッションで画面が固まるのを防ぐ
        syncOfficialQuestions(d);
        localStorage.setItem(LS_KEY, JSON.stringify(d));
        return d;
      }
    } catch (e) { console.warn('load failed', e); }
    const d = defaultData();
    localStorage.setItem(LS_KEY, JSON.stringify(d));
    return d;
  }

  function persistLocal() { localStorage.setItem(LS_KEY, JSON.stringify(data)); }

  function persist() { persistLocal(); schedulePush(); }

  /* ---------- 問題 CRUD ---------- */
  const questions = () => data.questions;
  const byId = id => data.questions.find(q => q.id === id);

  function addQuestion(q, overwrite = false) {
    const nq = normalizeQuestion(q);
    if (!nq.question || !nq.answer) return 'invalid';
    delete data.removedOfficial[nq.id]; // 再追加されたら削除記録を取り消す
    const idx = data.questions.findIndex(x => x.id === nq.id);
    if (idx >= 0) {
      if (!overwrite) return 'skipped';
      data.questions[idx] = nq;
      return 'updated';
    }
    data.questions.push(nq);
    return 'added';
  }

  function updateQuestion(id, fields) {
    const idx = data.questions.findIndex(q => q.id === id);
    if (idx < 0) return false;
    const prev = data.questions[idx];
    // 問題文が変わっても進捗を引き継ぐため id は据え置く
    const next = normalizeQuestion({ ...prev, ...fields, id });
    // 公式問題を端末側で編集したら custom 扱いにする（起動時の同期で巻き戻さないため）
    if (prev.origin === 'official' && !sameContent(prev, next)) next.origin = 'custom';
    data.questions[idx] = next;
    persist();
    return true;
  }

  function deleteQuestion(id) {
    const q = byId(id);
    if (q && q.origin === 'official') data.removedOfficial[id] = true; // 同期で復活させない
    data.questions = data.questions.filter(x => x.id !== id);
    delete data.progress[id];
    delete data.comments[id];
    delete data.unlearned[id];
    data.bookmarks = data.bookmarks.filter(b => b !== id);
    if (data.session) data.session.order = data.session.order.filter(x => x !== id);
    persist();
  }

  function deleteAllQuestions() {
    for (const q of data.questions) {
      if (q.origin === 'official') data.removedOfficial[q.id] = true;
    }
    data.questions = [];
    data.progress = {};
    data.comments = {};
    data.bookmarks = [];
    data.unlearned = {};
    data.session = null;
    persist();
  }

  function subUnits() {
    return [...new Set(data.questions.map(q => q.sub_unit))];
  }
  function units() {
    return [...new Set(data.questions.map(q => q.unit))];
  }
  function subUnitsOfUnit(unit) {
    return [...new Set(data.questions.filter(q => q.unit === unit).map(q => q.sub_unit))];
  }
  function allTags() {
    const set = new Set();
    for (const q of data.questions) {
      if (q.tags) for (const t of q.tags.split(' ')) if (t) set.add(t);
    }
    return [...set];
  }
  const tagsOf = id => { const q = byId(id); return q && q.tags ? q.tags.split(' ').filter(Boolean) : []; };

  /* ---------- 未習（まだ習っていない） ---------- */
  const isUnlearned = id => !!data.unlearned[id];
  function setUnlearned(id, on) {
    if (on) data.unlearned[id] = true; else delete data.unlearned[id];
    persist();
  }
  function setUnlearnedSubUnit(sub, on) {
    for (const q of data.questions) {
      if (q.sub_unit === sub) { if (on) data.unlearned[q.id] = true; else delete data.unlearned[q.id]; }
    }
    persist();
  }
  // 学習範囲設定用: unit（必須）・sub（省略で単元まるごと）で範囲指定して一括ON/OFF
  function scopeQuestions(unit, sub) {
    return data.questions.filter(q => q.unit === unit && (!sub || q.sub_unit === sub));
  }
  function setUnlearnedScope(unit, sub, on) {
    for (const q of scopeQuestions(unit, sub)) {
      if (on) data.unlearned[q.id] = true; else delete data.unlearned[q.id];
    }
    persist();
  }
  // その範囲の {total, unlearned} を返す（チェック状態とバッジ表示に使う）
  function unlearnedStat(unit, sub) {
    const qs = scopeQuestions(unit, sub);
    const u = qs.reduce((n, q) => n + (data.unlearned[q.id] ? 1 : 0), 0);
    return { total: qs.length, unlearned: u, learned: qs.length - u };
  }

  /* ---------- 解答・忘却曲線 ---------- */
  const dayStr = ts => new Date(ts).toLocaleDateString('sv-SE'); // YYYY-MM-DD（ローカル）

  // 忘却曲線の更新。grade: 'ng' | 'vague' | 'ok'
  function gradeSRS(s, grade, now) {
    const today = dayStr(now);
    if (grade === 'ng') {
      s.reps = 0; s.due = now + SRS_INTERVALS[0] * DAY; s.graduated = false;
    } else if (grade === 'vague') {
      s.due = now + SRS_INTERVALS[0] * DAY; s.graduated = false; // 段階は進めず最短へ
    } else { // ok（完璧）
      if (s.graduated) return; // すでに定着済みなら何もしない
      const isDue = s.due == null ? true : now >= s.due; // 新規 or 期限到来のみ前進
      if (isDue && s.lastAdvDay !== today) { // 段階アップは1日1回まで
        if (s.reps < SRS_INTERVALS.length) {
          s.due = now + SRS_INTERVALS[s.reps] * DAY;
          s.reps += 1;
          s.lastAdvDay = today;
        } else {
          s.graduated = true; s.due = null; s.reps += 1; s.lastAdvDay = today;
        }
      }
    }
  }

  function recordAnswer(id, grade) {
    if (!GRADES.includes(grade)) grade = grade ? 'ok' : 'ng'; // 旧bool互換
    const p = data.progress[id] || { first: null, status: null, attempts: 0, last: 0,
      srs: { reps: 0, due: null, graduated: false, lastAdvDay: '' } };
    p.srs = p.srs || { reps: 0, due: null, graduated: false, lastAdvDay: '' };
    delete data.unlearned[id]; // 解いたら「習った」扱い
    if (p.first == null) p.first = grade; // 初回結果は一度だけ
    p.status = grade;
    p.attempts += 1;
    p.last = Date.now();
    gradeSRS(p.srs, grade, p.last);
    data.progress[id] = p;
    persist();
  }

  const progressOf = id => data.progress[id] || null;

  // 表示用ステータス（書庫のバッジ等）
  function statusInfo(id) {
    if (isUnlearned(id)) return { key: 'unlearned', label: '未習' };
    const p = data.progress[id];
    if (!p || !p.attempts) return { key: 'untouched', label: '未着手' };
    if (p.srs && p.srs.graduated) return { key: 'graduated', label: '🎓定着' };
    return { key: p.status, label: GRADE_LABEL[p.status] || '—' };
  }

  /* ---------- 出題キュー ---------- */
  // 間違い復習: 完璧以外（ng / vague）。未習は除外。
  function reviewWrongIds(sub, type) {
    return data.questions.filter(q => !isUnlearned(q.id)).filter(q => {
      const p = data.progress[q.id];
      return p && (p.status === 'ng' || p.status === 'vague');
    }).filter(q => !sub || q.sub_unit === sub)
      .filter(q => !type || q.question_type === type).map(q => q.id);
  }
  // 今日の復習: 忘却曲線の期限が来た（卒業前）。
  function dueTodayIds(sub, type) {
    const now = Date.now();
    return data.questions.filter(q => !isUnlearned(q.id)).filter(q => {
      const p = data.progress[q.id];
      return p && p.srs && !p.srs.graduated && p.srs.due && p.srs.due <= now;
    }).filter(q => !sub || q.sub_unit === sub)
      .filter(q => !type || q.question_type === type).map(q => q.id);
  }
  function dueCount() { return dueTodayIds().length; }
  function graduatedCount() {
    return data.questions.filter(q => !isUnlearned(q.id))
      .filter(q => { const p = data.progress[q.id]; return p && p.srs && p.srs.graduated; }).length;
  }

  // 演習セッション用の候補ID（未習除外＋範囲/対象で絞る）
  function filterIds(scope, target) {
    let qs = data.questions.filter(q => !isUnlearned(q.id));
    if (scope && scope.kind && scope.kind !== 'all') {
      if (scope.kind === 'unit') qs = qs.filter(q => q.unit === scope.value);
      else if (scope.kind === 'sub') qs = qs.filter(q => q.sub_unit === scope.value);
      else if (scope.kind === 'tag') qs = qs.filter(q => (' ' + q.tags + ' ').includes(' ' + scope.value + ' '));
      else if (scope.kind === 'diff') qs = qs.filter(q => String(q.difficulty) === String(scope.value));
    }
    let ids = qs.map(q => q.id);
    if (target === 'weak') {
      ids = ids.filter(id => { const p = data.progress[id]; return p && p.attempts > 0 && p.status !== 'ok'; });
    }
    return ids;
  }

  function setComment(id, text) {
    text = String(text || '').trim();
    if (text) data.comments[id] = text; else delete data.comments[id];
    persist();
  }
  const commentOf = id => data.comments[id] || '';

  function toggleBookmark(id) {
    const i = data.bookmarks.indexOf(id);
    if (i >= 0) data.bookmarks.splice(i, 1); else data.bookmarks.push(id);
    persist();
    return i < 0;
  }
  const isBookmarked = id => data.bookmarks.includes(id);

  /* ---------- 分析指標 ----------
     未習は分母から除外。3段階は「集めるのは3段階・判定は2値（完璧のみ正解）・
     見せ方だけ3色」の方針で、内訳(firstBreak/statusBreak)も返す。
       初回正答率: 初回が「完璧」だった割合（あいまい・わからないは不正解扱い）
       理解度    : 解いた問題のうち最新が「完璧」の割合
       カバー率  : 未習を除く全問のうち1回でも解いた割合
       定着      : 🎓卒業した問題数 */
  function metrics(filterFn) {
    const qs = data.questions.filter(q => !isUnlearned(q.id)).filter(filterFn || (() => true));
    let total = qs.length, attempted = 0, graduated = 0;
    const fb = { ok: 0, vague: 0, ng: 0 }, sb = { ok: 0, vague: 0, ng: 0 };
    for (const q of qs) {
      const p = data.progress[q.id];
      if (p && p.attempts > 0) {
        attempted++;
        if (sb[p.status] !== undefined) sb[p.status]++;
        if (fb[p.first] !== undefined) fb[p.first]++;
        if (p.srs && p.srs.graduated) graduated++;
      }
    }
    const firstN = fb.ok + fb.vague + fb.ng;
    return {
      total, attempted, graduated,
      coverage: total ? attempted / total : 0,
      firstRate: firstN ? fb.ok / firstN : null,
      understanding: attempted ? sb.ok / attempted : null,
      firstBreak: fb, statusBreak: sb,
    };
  }

  // タグ（キーワード）ごとの指標。弱点分析用。
  function tagMetrics() {
    const map = {};
    for (const q of data.questions) {
      if (isUnlearned(q.id) || !q.tags) continue;
      for (const t of q.tags.split(' ')) {
        if (!t) continue;
        (map[t] = map[t] || new Set()).add(q.id);
      }
    }
    return Object.entries(map).map(([tag, ids]) => {
      const m = metrics(q => ids.has(q.id));
      return { tag, ...m };
    });
  }

  /* ---------- CSV ---------- */
  const CSV_HEADER = ['question', 'answer', 'unit', 'sub_unit', 'question_type', 'tags', 'difficulty'];

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuote = false;
    const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuote) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
        } else field += c;
      } else if (c === '"') {
        inQuote = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
    return rows;
  }

  function importCSV(text, overwrite = false) {
    const rows = parseCSV(text);
    if (!rows.length) return { added: 0, updated: 0, skipped: 0, errors: ['CSVが空です'] };

    // ヘッダー行の検出（sub-unit / sub_unit どちらも許容）
    const norm = h => h.trim().toLowerCase().replace(/-/g, '_');
    let map = CSV_HEADER.map((_, i) => i);
    let start = 0;
    const first = rows[0].map(norm);
    if (first.includes('question')) {
      map = CSV_HEADER.map(h => first.indexOf(h));
      start = 1;
    }

    const result = { added: 0, updated: 0, skipped: 0, errors: [] };
    for (let r = start; r < rows.length; r++) {
      const get = i => (map[i] >= 0 && map[i] < rows[r].length) ? rows[r][map[i]] : '';
      const q = {
        question: get(0), answer: get(1), unit: get(2),
        sub_unit: get(3), question_type: get(4), tags: get(5), difficulty: get(6),
      };
      if (!q.question.trim() || !q.answer.trim()) {
        result.errors.push(`${r + 1}行目: question / answer が空のためスキップ`);
        continue;
      }
      const res = addQuestion(q, overwrite);
      if (res === 'added') result.added++;
      else if (res === 'updated') result.updated++;
      else result.skipped++;
    }
    persist();
    return result;
  }

  function exportCSV() {
    const escape = v => {
      v = String(v == null ? '' : v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [CSV_HEADER.join(',')];
    for (const q of data.questions) {
      lines.push(CSV_HEADER.map(h => escape(q[h])).join(','));
    }
    return lines.join('\n');
  }

  /* ---------- クラウド同期（Firebase Realtime Database REST） ----------
     アプリ所有者が一度だけ無料の Firebase プロジェクトを作り、
     その databaseURL を js/sync-config.js か同期タブで設定する。
     生徒側はログイン不要・同期IDの入力だけで保存/復元できる。 */
  let pushTimer = null;

  function payloadObj() {
    return {
      app: 'chemflash', version: 3, updatedAt: Date.now(),
      questions: data.questions, progress: data.progress,
      comments: data.comments, bookmarks: data.bookmarks,
      unlearned: data.unlearned, removedOfficial: data.removedOfficial,
      totalCycles: data.totalCycles,
    };
  }

  function dbUrl() {
    const url = (data.dbUrl || (typeof window !== 'undefined' && window.CHEMFLASH_SYNC_URL) || '').trim();
    return url.replace(/\/+$/, '');
  }

  function setDbUrl(url) {
    data.dbUrl = String(url || '').trim();
    persistLocal();
  }

  function syncEndpoint(id) {
    return dbUrl() + '/chemflash/' + encodeURIComponent(id) + '.json';
  }

  function newSyncId() {
    // 紛らわしい文字（0/O, 1/I/L）を除いた読みやすいID
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const block = n => Array.from({ length: n }, () =>
      chars[Math.floor(Math.random() * chars.length)]).join('');
    return `CF-${block(4)}-${block(4)}-${block(4)}`;
  }

  function schedulePush() {
    if (!data.syncId || !dbUrl()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncPush().catch(e => console.warn('auto sync failed', e)), 3000);
  }

  async function syncCreate() {
    if (!dbUrl()) throw new Error('同期サーバが未設定です（同期タブの「同期サーバの設定」を参照）');
    const id = newSyncId();
    data.syncId = id;
    await syncPush();
    return id;
  }

  async function syncPush() {
    if (!data.syncId) throw new Error('同期IDが設定されていません');
    if (!dbUrl()) throw new Error('同期サーバが未設定です');
    const res = await fetch(syncEndpoint(data.syncId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadObj()),
    });
    if (!res.ok) throw new Error('クラウド保存に失敗しました (' + res.status + ')');
    data.lastSync = Date.now();
    persistLocal();
  }

  /* ---------- フィードバック（テキストのみ・管理画面で確認） ---------- */
  async function sendFeedback(text) {
    text = String(text || '').trim();
    if (!text) throw new Error('内容を入力してください');
    if (!dbUrl()) throw new Error('送信先が未設定です');
    const res = await fetch(dbUrl() + '/chemflash/feedback.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, at: Date.now() }),
    });
    if (!res.ok) throw new Error('送信に失敗しました (' + res.status + ')');
  }

  async function syncPull(id) {
    id = String(id || '').trim();
    if (!id) throw new Error('同期IDを入力してください');
    if (!dbUrl()) throw new Error('同期サーバが未設定です');
    const res = await fetch(syncEndpoint(id));
    if (!res.ok) throw new Error('データの取得に失敗しました。IDを確認してください (' + res.status + ')');
    const remote = await res.json();
    if (!remote || remote.app !== 'chemflash') throw new Error('この同期IDのデータが見つかりません');
    applyRemote(remote);
    data.syncId = id;
    data.lastSync = Date.now();
    persistLocal();
  }

  function applyRemote(remote) {
    data.questions = (remote.questions || []).map(normalizeQuestion);
    data.progress = migrateProgress(remote.progress);
    data.comments = remote.comments || {};
    data.bookmarks = remote.bookmarks || [];
    data.unlearned = remote.unlearned || {};
    data.removedOfficial = remote.removedOfficial || {};
    data.totalCycles = remote.totalCycles || 0;
    data.session = null; // 端末をまたいだら演習セッションは作り直す
    syncOfficialQuestions(data); // 古いバックアップを取り込んでも公式問題は最新に揃える
  }

  /* ---------- ファイルバックアップ（同期サーバなしでも使える） ---------- */
  function exportBackup() {
    return JSON.stringify(payloadObj(), null, 1);
  }

  function importBackup(text) {
    let obj;
    try { obj = JSON.parse(text); } catch { throw new Error('JSONファイルとして読み込めませんでした'); }
    if (!obj || obj.app !== 'chemflash') throw new Error('ChemFlash のバックアップファイルではありません');
    applyRemote(obj);
    persistLocal();
  }

  data = load();

  return {
    raw: () => data,
    persist, persistLocal,
    questions, byId, subUnits, subUnitsOfUnit, units, allTags, tagsOf,
    addQuestion, updateQuestion, deleteQuestion, deleteAllQuestions,
    recordAnswer, progressOf, statusInfo,
    isUnlearned, setUnlearned, setUnlearnedSubUnit, setUnlearnedScope, unlearnedStat,
    reviewWrongIds, dueTodayIds, dueCount, graduatedCount, filterIds,
    setComment, commentOf,
    toggleBookmark, isBookmarked,
    metrics, tagMetrics,
    parseCSV, importCSV, exportCSV, CSV_HEADER,
    syncCreate, syncPush, syncPull, dbUrl, setDbUrl, sendFeedback,
    exportBackup, importBackup,
    TYPES, GRADES, GRADE_LABEL, DEFAULT_UNIT, SRS_INTERVALS,
  };
})();
