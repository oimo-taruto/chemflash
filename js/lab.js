/* =========================================================
   ChemFlash 実験室の部品（フラスコ・試験管・ビーカー・分子）
   見た目だけ。学習データには一切触れない。
   ========================================================= */
'use strict';

const ChemLab = (() => {
  let uid = 0;
  const nid = p => p + (++uid);
  const COL = { ok: '#34d399', vague: '#fbbf24', ng: '#fb923c' };
  const f1 = v => (Math.round(v * 10) / 10).toString();

  // 丸底フラスコ。layers = [[色, 割合0〜1], ...]（下から積む）
  function flask({ layers = [], glow = null, bubbles = false, spark = false, cls = '' } = {}) {
    const id = nid('fk');
    const full = 76, bottom = 134;
    let y = bottom + 6, total = 0, rects = '';
    for (const [c, f] of layers) {
      if (!(f > 0)) continue;
      total += f;
      const top = bottom - total * full;
      rects += `<rect x="0" y="${f1(top)}" width="120" height="${f1(y - top)}" fill="${c}"/>`;
      y = top;
    }
    const surf = bottom - total * full;
    const wave = total > 0 ? `<path d="M0 ${f1(surf + 2)} Q30 ${f1(surf - 3)} 60 ${f1(surf + 1)} T120 ${f1(surf)}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2"/>
      <path d="M0 ${f1(surf + 2)} Q30 ${f1(surf - 3)} 60 ${f1(surf + 1)} T120 ${f1(surf)} V${f1(surf + 6)} H0Z" fill="#fff" fill-opacity=".12"/>` : '';
    const bub = bubbles && total > 0 ? `<circle cx="48" cy="${bottom - 14}" r="4" fill="#fff" fill-opacity=".45"/><circle cx="70" cy="${bottom - 30}" r="2.6" fill="#fff" fill-opacity=".5"/><circle cx="58" cy="${f1(surf + 10)}" r="2" fill="#fff" fill-opacity=".55"/><circle cx="64" cy="${f1(surf - 14)}" r="2.4" fill="none" stroke="#fff" stroke-opacity=".5"/><circle cx="56" cy="${f1(surf - 32)}" r="1.8" fill="none" stroke="#fff" stroke-opacity=".4"/>` : '';
    const sp = spark && glow ? `<g stroke="${glow}" stroke-width="1.8" stroke-linecap="round" opacity=".9"><path d="M98 24v9M93.5 28.5h9"/><path d="M20 40v6M17 43h6"/><path d="M104 64v5M101.5 66.5h5"/></g>` : '';
    return `<svg class="flask ${cls}" viewBox="0 0 120 140" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="M49 6 L49 51.5 A42 42 0 1 0 71 51.5 L71 6 Z"/></clipPath>
        <linearGradient id="${id}s" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
        <filter id="${id}g" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="12"/></filter></defs>
      ${glow ? `<ellipse cx="60" cy="100" rx="44" ry="36" fill="${glow}" opacity=".45" filter="url(#${id}g)"/>` : ''}
      <g clip-path="url(#${id})">${rects}${wave}<rect x="0" y="0" width="120" height="140" fill="url(#${id}s)"/>${bub}</g>
      <path d="M49 6 L49 51.5 A42 42 0 1 0 71 51.5 L71 6" fill="rgba(255,255,255,.04)" stroke="rgba(235,245,255,.6)" stroke-width="2.2"/>
      <rect x="44.5" y="2" width="31" height="7" rx="3.5" fill="none" stroke="rgba(235,245,255,.6)" stroke-width="2"/>
      <path d="M30 78 A32 32 0 0 1 44 62" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".28"/>
      <rect x="53" y="12" width="3" height="34" rx="1.5" fill="#fff" opacity=".18"/>
      ${sp}</svg>`;
  }

  // 横置きの試験管。segs = [['ok', 数], ['vague', 数], ['ng', 数]]、total = 全体の数
  function tube(segs, total) {
    const id = nid('tb');
    const x0 = 12, w = 238;
    let x = x0, rects = '';
    const t = Math.max(total || 0, 1);
    for (const [k, n] of segs) {
      if (!(n > 0)) continue;
      const ww = Math.min(w, n / t * w);
      rects += `<rect x="${f1(x - .5)}" y="0" width="${f1(ww + 1)}" height="30" fill="${COL[k] || k}"/>`;
      x += ww;
    }
    const end = Math.min(x, x0 + w);
    const filled = end > x0 + 1;
    return `<svg class="tube" viewBox="0 0 262 30" preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id="${id}"><rect x="${x0}" y="7" width="${w}" height="16" rx="8"/></clipPath>
        <linearGradient id="${id}v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
        <filter id="${id}g" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="4"/></filter></defs>
      ${filled ? `<rect x="${x0}" y="9" width="${f1(end - x0)}" height="12" rx="6" fill="#45e3cf" opacity=".3" filter="url(#${id}g)"/>` : ''}
      <g clip-path="url(#${id})">${rects}${filled ? `<path d="M${f1(end - 3)} 7 Q${f1(end + 4)} 15 ${f1(end - 3)} 23 H${f1(end - 8)} V7Z" fill="#fff" fill-opacity=".25"/>` : ''}<rect x="${x0}" y="0" width="${w}" height="30" fill="url(#${id}v)"/></g>
      <rect x="${x0 - 2}" y="5" width="${w + 4}" height="20" rx="10" fill="rgba(255,255,255,.035)" stroke="rgba(235,245,255,.5)" stroke-width="1.6"/>
      <rect x="${x0 - 7}" y="2" width="7" height="26" rx="3" fill="none" stroke="rgba(235,245,255,.5)" stroke-width="1.6"/>
      <rect x="${x0 + 6}" y="8.5" width="${w - 20}" height="2" rx="1" fill="#fff" opacity=".22"/>
    </svg>`;
  }

  // たての小さな試験管。layers = [[色, 割合], ...]
  function vial(layers = [], glow = null) {
    const id = nid('vl'), full = 62, bottom = 74;
    let y = bottom + 4, total = 0, rects = '';
    for (const [c, f] of layers) {
      if (!(f > 0)) continue;
      total += Math.min(f, 1 - total);
      const top = bottom - total * full;
      rects += `<rect x="0" y="${f1(top)}" width="26" height="${f1(y - top)}" fill="${c}"/>`;
      y = top;
    }
    const surf = bottom - total * full;
    return `<svg class="vial" viewBox="0 0 26 80" aria-hidden="true">
      <defs><clipPath id="${id}"><path d="M6 6 V67 A7 7 0 0 0 20 67 V6Z"/></clipPath>
        <linearGradient id="${id}s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
        <filter id="${id}g" x="-100%" y="-50%" width="300%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>
      ${glow && total > 0 ? `<rect x="2" y="${f1(surf)}" width="22" height="${f1(bottom - surf + 4)}" rx="10" fill="${glow}" opacity=".4" filter="url(#${id}g)"/>` : ''}
      <g clip-path="url(#${id})">${rects}${total > 0 ? `<rect x="0" y="${f1(surf)}" width="26" height="1.6" fill="#fff" opacity=".5"/>` : ''}<rect x="0" y="0" width="26" height="80" fill="url(#${id}s)"/></g>
      <path d="M6 6 V67 A7 7 0 0 0 20 67 V6" fill="rgba(255,255,255,.035)" stroke="rgba(235,245,255,.55)" stroke-width="1.6"/>
      <rect x="3.5" y="2.5" width="19" height="4.5" rx="2" fill="none" stroke="rgba(235,245,255,.55)" stroke-width="1.4"/>
      <rect x="8.6" y="11" width="2" height="46" rx="1" fill="#fff" opacity=".2"/></svg>`;
  }

  // 横の細い試験管（割合 0〜1）
  function mtube(ratio, color) {
    const id = nid('mt'), w = 86 * Math.max(0, Math.min(1, ratio || 0));
    return `<svg class="mt" viewBox="0 0 92 14" aria-hidden="true"><defs><clipPath id="${id}"><rect x="4" y="2" width="86" height="10" rx="5"/></clipPath></defs>
      <g clip-path="url(#${id})"><rect x="4" y="0" width="${f1(w)}" height="14" fill="${color}"/><rect x="4" y="3" width="86" height="2" fill="#fff" opacity=".22"/></g>
      <rect x="3" y="1" width="88" height="12" rx="6" fill="rgba(255,255,255,.03)" stroke="rgba(235,245,255,.42)" stroke-width="1.3"/>
      <rect x=".5" y="0" width="3.5" height="14" rx="1.5" fill="none" stroke="rgba(235,245,255,.42)" stroke-width="1.2"/></svg>`;
  }

  // ビーカーの評価ボタン
  function beaker(grade, icon, label) {
    return `<button class="beaker k-${grade}" data-g="${grade}">
      <svg class="liq" viewBox="0 0 100 96" preserveAspectRatio="none" aria-hidden="true"><path d="M0 50 C20 44 35 56 55 49 S85 44 100 50 V96 H0Z" fill="var(--k)" fill-opacity=".26"/><path d="M0 50 C20 44 35 56 55 49 S85 44 100 50" fill="none" stroke="var(--k)" stroke-opacity=".7" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>
      <span class="gr"><i></i><i></i><i></i></span>
      <span class="ico">${icon}</span><span class="lb">${label}</span></button>`;
  }

  /* 分子（5つの単元を5員環に）。atoms = [{unit, sym, color, p(0〜1|null)}] */
  const POS = [[62, 78], [165, 30], [268, 78], [228, 172], [102, 172]];
  const LPOS = [[62, 122], [165, 74], [268, 122], [276, 177], [56, 177]];
  function molecule(atoms, sel) {
    const id = nid('ml');
    const C = 163.4;
    const glows = atoms.map((a, i) => {
      const on = a.unit === sel;
      const p = a.p || 0;
      return (p >= .4 || on) ? `<circle cx="${POS[i][0]}" cy="${POS[i][1]}" r="${on ? 34 : 28}" fill="${a.color}" opacity="${on ? .5 : f1(p * .5)}" filter="url(#${id})"/>` : '';
    }).join('');
    const nodes = atoms.map((a, i) => {
      const [x, y] = POS[i], [lx, ly] = LPOS[i];
      const on = a.unit === sel;
      const p = a.p == null ? 0 : a.p;
      return `<g class="atom-hit" data-unit="${a.unitAttr}" role="button" tabindex="0" aria-label="${a.label}">
        <circle cx="${x}" cy="${y}" r="34" fill="transparent"/>
        <circle cx="${x}" cy="${y}" r="26" fill="${on ? '#18223d' : '#0e1527'}"/>
        <circle cx="${x}" cy="${y}" r="26" fill="none" stroke="#222d4a" stroke-width="5"/>
        ${p > 0 ? `<circle cx="${x}" cy="${y}" r="26" fill="none" stroke="${a.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${f1(C * (1 - p))}" transform="rotate(-90 ${x} ${y})"/>` : ''}
        ${on ? `<circle cx="${x}" cy="${y}" r="33" fill="none" stroke="${a.color}" stroke-width="1.5" stroke-dasharray="3 4"/>` : ''}
        <text x="${x}" y="${y + 7}" font-size="19" fill="${a.color}">${a.sym}</text>
        <text x="${lx}" y="${ly}" font-size="11.5" fill="#c9d3ea">${a.p == null ? '—' : Math.round(a.p * 100) + '%'}</text></g>`;
    }).join('');
    return `<svg class="mol-svg" viewBox="0 0 330 205">
      <defs><filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter></defs>
      <g stroke="#2c3858" stroke-width="4.5" stroke-linecap="round">
        <line x1="62" y1="78" x2="165" y2="30"/><line x1="165" y1="30" x2="268" y2="78"/><line x1="268" y1="78" x2="228" y2="172"/><line x1="228" y1="172" x2="102" y2="172"/><line x1="102" y1="172" x2="62" y2="78"/>
        <line x1="124" y1="157" x2="206" y2="157" stroke-width="3"/></g>
      ${glows}
      <g font-family="Nunito, sans-serif" font-weight="900" text-anchor="middle">${nodes}</g></svg>`;
  }

  return { flask, tube, vial, mtube, beaker, molecule, COL };
})();
