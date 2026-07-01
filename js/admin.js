/* =========================================================
   ChemFlash 問題管理画面
   - CSVインポート（貼り付け / ファイル）
   - 1問ずつ追加・編集・削除
   - 一覧の検索・絞り込み、CSVエクスポート
   ========================================================= */
'use strict';

(() => {
  const S = ChemStore;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'show ' + kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 2200);
  }

  /* ---------- 利用状況 ---------- */
  async function loadUserStats() {
    const wrap = document.getElementById('user-stats');
    const url = S.dbUrl();
    if (!url) { wrap.innerHTML = '<p class="muted small">同期サーバが未設定です</p>'; return; }
    try {
      const res = await fetch(url + '/chemflash/pings.json?shallow=true');
      if (!res.ok) throw new Error('読み込みに失敗 (' + res.status + ')');
      const data = (await res.json()) || {};
      const count = Object.keys(data).length;
      wrap.innerHTML = `<p style="font-size:1.4rem;font-weight:800;margin:4px 0">${count}<span style="font-size:.85rem;font-weight:400;color:var(--text-dim)"> 端末</span></p>
        <p class="muted small" style="margin:0">アプリを開いたことのあるユニーク端末数</p>`;
    } catch(e) {
      wrap.innerHTML = `<p class="muted small">読み込みに失敗しました: ${esc(e.message)}</p>`;
    }
  }
  document.getElementById('stats-refresh').addEventListener('click', loadUserStats);
  loadUserStats();

  /* ---------- フィードバック ---------- */
  async function loadFeedback() {
    const wrap = document.getElementById('feedback-list');
    const url = S.dbUrl();
    if (!url) { wrap.innerHTML = '<p class="muted small">送信先（同期サーバ）が未設定です</p>'; return; }
    wrap.innerHTML = '<p class="muted small">読み込み中…</p>';
    try {
      const res = await fetch(url + '/chemflash/feedback.json');
      if (!res.ok) throw new Error('読み込みに失敗しました (' + res.status + ')');
      const list = (await res.json()) || {};
      const items = Object.entries(list).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
      if (!items.length) { wrap.innerHTML = '<p class="muted small">フィードバックはまだありません</p>'; return; }
      wrap.innerHTML = items.map(([id, f]) => `
        <div class="fb-item" data-id="${esc(id)}">
          <div class="fb-date">${f.at ? new Date(f.at).toLocaleString('ja-JP') : ''}</div>
          <div class="fb-text">${esc(f.text || '')}</div>
          <button class="btn sm danger" data-act="fb-del">削除</button>
        </div>`).join('');
      wrap.querySelectorAll('[data-act="fb-del"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('このフィードバックを削除しますか？')) return;
          const id = btn.closest('.fb-item').dataset.id;
          await fetch(url + '/chemflash/feedback/' + encodeURIComponent(id) + '.json', { method: 'DELETE' });
          loadFeedback();
        });
      });
    } catch (e) {
      wrap.innerHTML = `<p class="muted small">読み込みに失敗しました: ${esc(e.message)}</p>`;
    }
  }
  document.getElementById('fb-refresh').addEventListener('click', loadFeedback);
  loadFeedback();

  /* ---------- CSV インポート ---------- */
  function runImport(text) {
    const overwrite = document.getElementById('csv-overwrite').checked;
    const r = S.importCSV(text, overwrite);
    const parts = [`追加 ${r.added}件`, `上書き ${r.updated}件`, `スキップ(重複) ${r.skipped}件`];
    const el = document.getElementById('import-result');
    el.innerHTML = `✅ ${parts.join(' / ')}` +
      (r.errors.length ? `<br><span style="color:var(--orange)">⚠ ${r.errors.map(esc).join('<br>⚠ ')}</span>` : '');
    if (r.added || r.updated) {
      document.getElementById('csv-input').value = '';
      toast(`${r.added + r.updated}件 取り込みました`, 'good');
    } else if (!r.errors.length) {
      toast('新しく追加された問題はありません');
    }
    refreshAll();
  }

  document.getElementById('import-btn').addEventListener('click', () => {
    const text = document.getElementById('csv-input').value;
    if (!text.trim()) { toast('CSVを貼り付けてください', 'bad'); return; }
    runImport(text);
  });

  document.getElementById('csv-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { runImport(String(reader.result)); e.target.value = ''; };
    reader.readAsText(file, 'utf-8');
  });

  /* ---------- 1問ずつ追加 ---------- */
  document.getElementById('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const q = Object.fromEntries(f.entries());
    const res = S.addQuestion(q, false);
    if (res === 'added') {
      S.persist();
      toast('問題を追加しました ✔', 'good');
      e.target.reset();
      e.target.querySelector('[name="unit"]').value = S.DEFAULT_UNIT;
      refreshAll();
    } else if (res === 'skipped') {
      toast('同じ問題文がすでに登録されています', 'bad');
    } else {
      toast('question と answer は必須です', 'bad');
    }
  });

  /* ---------- 一覧 ---------- */
  /* ---------- チェック状態（管理者メモ用・Firebaseで端末間共有、localStorageはキャッシュ） ---------- */
  const CHECKED_KEY = 'chemflash_admin_checked';
  let checkedIds = new Set(JSON.parse(localStorage.getItem(CHECKED_KEY) || '[]'));
  function saveCheckedLocal() {
    localStorage.setItem(CHECKED_KEY, JSON.stringify([...checkedIds]));
  }

  let checkedPushTimer = null;
  function saveChecked() {
    saveCheckedLocal();
    const url = S.dbUrl();
    if (!url) return;
    clearTimeout(checkedPushTimer);
    checkedPushTimer = setTimeout(() => {
      fetch(url + '/chemflash/admin_checked.json', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([...checkedIds]),
      }).catch(() => {});
    }, 800);
  }

  async function loadCheckedRemote() {
    const url = S.dbUrl();
    if (!url) return;
    try {
      const res = await fetch(url + '/chemflash/admin_checked.json');
      if (!res.ok) return;
      const arr = await res.json();
      if (Array.isArray(arr)) {
        checkedIds = new Set(arr);
        saveCheckedLocal();
        refreshTable();
      }
    } catch (e) { /* オフライン時はローカルのキャッシュのまま */ }
  }

  const filter = { text: '', sub: '', type: '', checked: '' };

  function refreshFilters() {
    const subSel = document.getElementById('f-sub');
    const keep = filter.sub;
    subSel.innerHTML = '<option value="">すべての分野</option>' +
      S.subUnits().map(s => `<option value="${esc(s)}" ${s === keep ? 'selected' : ''}>${esc(s)}</option>`).join('');

    const typeSel = document.getElementById('f-type');
    typeSel.innerHTML = '<option value="">すべてのタイプ</option>' +
      S.TYPES.map(t => `<option ${t === filter.type ? 'selected' : ''}>${esc(t)}</option>`).join('');

    document.getElementById('sub-list').innerHTML =
      S.subUnits().map(s => `<option value="${esc(s)}">`).join('');
  }

  function visibleQuestions() {
    const t = filter.text.toLowerCase();
    return S.questions().filter(q =>
      (!filter.sub || q.sub_unit === filter.sub) &&
      (!filter.type || q.question_type === filter.type) &&
      (!filter.checked || (filter.checked === 'checked') === checkedIds.has(q.id)) &&
      (!t || (q.question + ' ' + q.answer + ' ' + q.tags).toLowerCase().includes(t)));
  }

  function refreshTable() {
    const qs = visibleQuestions();
    const all = S.questions();
    const checkedCount = all.filter(q => checkedIds.has(q.id)).length;
    document.getElementById('q-count').textContent =
      `（表示 ${qs.length} / 全 ${all.length} 問）`;
    document.getElementById('check-stats').textContent =
      `チェック済み：${checkedCount}問　未チェック：${all.length - checkedCount}問`;
    document.getElementById('q-tbody').innerHTML = qs.map(q => `
      <tr data-qid="${esc(q.id)}">
        <td style="text-align:center;vertical-align:middle">
          <input type="checkbox" data-act="check" ${checkedIds.has(q.id) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--green,#4f9)">
        </td>
        <td class="q-cell">
          <div>${esc(q.question)}</div>
          <div class="ans">→ ${esc(q.answer)}</div>
          ${q.tags ? `<div class="tags" style="margin-top:3px">${q.tags.split(' ').filter(Boolean).map(t => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
        </td>
        <td><span class="chip sub">${esc(q.sub_unit)}</span></td>
        <td><span class="chip type-${esc(q.question_type)}">${esc(q.question_type)}</span></td>
        <td><span class="diff">${'★'.repeat(q.difficulty)}${'☆'.repeat(3 - q.difficulty)}</span></td>
        <td style="white-space:nowrap">
          <button class="btn sm" data-act="edit">編集</button>
          <button class="btn sm danger" data-act="del">削除</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">該当する問題がありません</td></tr>';
  }

  function refreshAll() { refreshFilters(); refreshTable(); }

  document.getElementById('f-search').addEventListener('input', e => {
    filter.text = e.target.value; refreshTable();
  });
  document.getElementById('f-sub').addEventListener('change', e => {
    filter.sub = e.target.value; refreshTable();
  });
  document.getElementById('f-type').addEventListener('change', e => {
    filter.type = e.target.value; refreshTable();
  });
  document.getElementById('f-checked').addEventListener('change', e => {
    filter.checked = e.target.value; refreshTable();
  });

  /* ---------- 編集 / 削除（行ボタン） ---------- */
  const dialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  let editingId = null;

  document.getElementById('q-tbody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.qid;
    const q = S.byId(id);
    if (!q) return;

    if (btn.dataset.act === 'del') {
      if (confirm('この問題を削除しますか？\n\n' + q.question)) {
        S.deleteQuestion(id);
        toast('削除しました');
        refreshAll();
      }
    } else if (btn.dataset.act === 'edit') {
      editingId = id;
      for (const name of ['question', 'answer', 'unit', 'sub_unit', 'question_type', 'tags', 'difficulty']) {
        editForm.elements[name].value = q[name];
      }
      dialog.showModal();
    }
  });

  document.getElementById('q-tbody').addEventListener('change', e => {
    const cb = e.target.closest('input[data-act="check"]');
    if (!cb) return;
    const id = cb.closest('tr').dataset.qid;
    if (cb.checked) checkedIds.add(id); else checkedIds.delete(id);
    saveChecked();
    refreshTable();
  });

  editForm.addEventListener('submit', e => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    const f = new FormData(editForm);
    S.updateQuestion(editingId, Object.fromEntries(f.entries()));
    toast('保存しました ✔', 'good');
    refreshAll();
  });

  /* ---------- エクスポート / 全削除 ---------- */
  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob(['﻿' + S.exportCSV()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chemflash_questions.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('delete-all-btn').addEventListener('click', () => {
    if (!confirm('全問題と学習記録（進捗・メモ・保存）をすべて削除します。本当によろしいですか？')) return;
    if (!confirm('この操作は元に戻せません。実行しますか？')) return;
    S.deleteAllQuestions();
    toast('すべて削除しました');
    refreshAll();
  });

  async function doPublish() {
    const result = document.getElementById('publish-result');
    if (!confirm(`現在の ${S.questions().length} 問をアプリに配信します。生徒が次にアプリを開いたときに反映されます。よろしいですか？`)) return;
    document.querySelectorAll('.publish-btn').forEach(b => { b.disabled = true; b.textContent = '配信中…'; });
    result.textContent = '';
    try {
      await S.publishOfficialQuestions();
      const n = S.questions().length;
      result.innerHTML = `✅ ${n} 問を配信しました。生徒がアプリを開き直すと反映されます。`;
      toast(`${n} 問を配信しました`, 'good');
    } catch(e) {
      result.innerHTML = `<span style="color:var(--orange)">⚠ ${esc(e.message)}</span>`;
      toast('配信に失敗しました', 'bad');
    } finally {
      document.querySelectorAll('.publish-btn').forEach(b => { b.disabled = false; b.textContent = '🚀 アプリに配信する'; });
    }
  }
  document.querySelectorAll('.publish-btn').forEach(btn => btn.addEventListener('click', doPublish));

  refreshAll();
  loadCheckedRemote();
})();
