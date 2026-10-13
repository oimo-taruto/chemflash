/* =========================================================
   ChemFlash 管理者ログイン（admin.html 専用）
   公式問題の配信・利用状況・フィードバック・チェック状態は、管理者だけが読み書きできる
   （Firebase のルール: firebase-rules.json）。ここで Firebase Authentication（メール/パスワード）に
   REST でログインし、ID トークンを ?auth= で付けて読み書きする。SDK は読み込まない（ビルド不要の方針）。

   - ログイン情報（リフレッシュトークン）はこの端末の localStorage に残る（管理者の端末だけで開く前提）
   - ID トークンは1時間で切れるので、切れる少し前にリフレッシュトークンで取り直す
   - パスワードはどこにも保存しない
   ========================================================= */
'use strict';

const AdminAuth = (() => {
  const REFRESH_KEY = 'chemflash_admin_refresh';
  const EMAIL_KEY = 'chemflash_admin_email';
  let idToken = null;
  let expiresAt = 0;

  function apiKey() {
    const key = (window.CHEMFLASH_API_KEY || '').trim();
    if (!key) throw new Error('sync-config.js に CHEMFLASH_API_KEY が設定されていません');
    return key;
  }

  function save(token, refresh, expiresIn) {
    idToken = token;
    expiresAt = Date.now() + (Number(expiresIn) || 3600) * 1000;
    localStorage.setItem(REFRESH_KEY, refresh);
  }

  async function signIn(email, password) {
    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(apiKey()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (body.error && body.error.message) || String(res.status);
      if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(code)) {
        throw new Error('メールアドレスかパスワードが違います');
      }
      if (/TOO_MANY_ATTEMPTS/.test(code)) throw new Error('試した回数が多すぎます。しばらく待ってからもう一度');
      throw new Error('ログインできませんでした（' + code + '）');
    }
    save(body.idToken, body.refreshToken, body.expiresIn);
    localStorage.setItem(EMAIL_KEY, body.email || email);
  }

  async function refresh() {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
    });
    if (!res.ok) {
      // パスワードを変えた・アカウントを止めた などで使えなくなった → ログアウト扱い
      if (res.status === 400 || res.status === 401 || res.status === 403) signOut();
      return null;
    }
    const body = await res.json();
    save(body.id_token, body.refresh_token, body.expires_in);
    return idToken;
  }

  /** 有効な ID トークン（ログインしていなければ null）。切れる1分前から取り直す。 */
  async function token() {
    if (idToken && Date.now() < expiresAt - 60 * 1000) return idToken;
    return refresh();
  }

  function signOut() {
    idToken = null;
    expiresAt = 0;
    localStorage.removeItem(REFRESH_KEY);
  }

  function isSignedIn() {
    return Boolean(localStorage.getItem(REFRESH_KEY));
  }

  function email() {
    return localStorage.getItem(EMAIL_KEY) || '';
  }

  /** Firebase の URL に ?auth=（ID トークン）を付ける。ログインしていなければエラー。 */
  async function authed(url) {
    const t = await token();
    if (!t) throw new Error('管理者としてログインしてください');
    return url + (url.includes('?') ? '&' : '?') + 'auth=' + encodeURIComponent(t);
  }

  return { signIn, signOut, isSignedIn, email, token, authed };
})();
