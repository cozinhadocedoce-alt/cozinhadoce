// Ícone do app (macaron) desenhado no aparelho, com o fundo na cor que o administrador escolher.
// É o mesmo desenho de icons/icon.svg; aqui ele vira PNG para ser enviado como ícone do app.

// Mistura duas cores "#rrggbb" (t = 0 fica com a, 1 fica com b).
export function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const macaron = (cx, cy, w, c, id) => {
  const x0 = cx - w / 2, x1 = cx + w / 2, s = w / 300;
  const top = cy - 30 * s, bot = cy + 30 * s;
  const foot = (y, dir) => {
    const n = 16, ww = (w - 8 * s) / n;
    let d = `M${x0 + 4 * s} ${y}`;
    for (let i = 0; i < n; i++) d += ` q${ww / 2} ${dir * 9 * s} ${ww} 0`;
    return `${d} L${x1 - 4 * s} ${y - dir * 14 * s} L${x0 + 4 * s} ${y - dir * 14 * s} Z`;
  };
  return `<g><defs><linearGradient id="t${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs>
    <rect x="${x0 + 16 * s}" y="${top + 6 * s}" width="${w - 32 * s}" height="${bot - top - 12 * s}" rx="${18 * s}" fill="${c[3]}"/>
    <path d="${foot(top + 6 * s, 1)}" fill="${c[2]}"/><path d="${foot(bot - 6 * s, -1)}" fill="${c[2]}"/>
    <path d="M${x0} ${top - 6 * s} C${x0} ${top - 112 * s} ${x1} ${top - 112 * s} ${x1} ${top - 6 * s} Q${cx} ${top + 2 * s} ${x0} ${top - 6 * s}Z" fill="url(#t${id})"/>
    <ellipse cx="${cx - 58 * s}" cy="${top - 56 * s}" rx="${50 * s}" ry="${15 * s}" fill="#fff" opacity=".6" transform="rotate(-10 ${cx - 58 * s} ${top - 56 * s})"/>
    <path d="M${x0} ${bot + 6 * s} Q${cx} ${bot - 2 * s} ${x1} ${bot + 6 * s} C${x1} ${bot + 72 * s} ${x0} ${bot + 72 * s} ${x0} ${bot + 6 * s}Z" fill="url(#t${id})"/></g>`;
};

// SVG do ícone. Sem `round`, o quadrado é cheio (o celular recorta o formato sozinho).
export function iconSvg(bg = '#e5568a', round = false) {
  const light = mix(bg, '#ffb36b', 0.45);
  const dark = mix(bg, '#2a0d16', 0.3);
  const shadow = mix(bg, '#000000', 0.55);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${bg}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>
  <rect width="512" height="512" rx="${round ? 112 : 0}" fill="url(#bg)"/>
  <g fill="#fff" opacity=".35"><circle cx="96" cy="110" r="10"/><circle cx="420" cy="92" r="7"/><circle cx="440" cy="410" r="11"/><circle cx="80" cy="400" r="6"/></g>
  <g transform="rotate(14 340 170)">${macaron(340, 170, 170, ['#c9f1e3', '#8fd9bf', '#7cc9ad', '#fff7ec'], 'm')}</g>
  <ellipse cx="244" cy="428" rx="150" ry="16" fill="${shadow}" opacity=".25"/>
  ${macaron(240, 316, 290, ['#fff0f5', '#ffc2d4', '#f59bb6', '#7a4a32'], 'p')}
  <g fill="#f6c454"><circle cx="210" cy="232" r="4"/><circle cx="236" cy="222" r="3"/><circle cx="292" cy="238" r="3.5"/><circle cx="262" cy="214" r="2.5"/><circle cx="320" cy="226" r="2.5"/></g>
</svg>`;
}

export const iconDataUrl = (bg, round = true) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(bg, round));

// PNG quadrado do ícone no tamanho pedido.
export async function iconPng(bg, size) {
  const img = new Image();
  img.src = iconDataUrl(bg, false);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(img, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível criar o ícone.'))), 'image/png'));
}
