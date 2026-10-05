/**
 * 시간 → 색 (가까움=초록 → 멂=빨강)
 */

export function isochroneColor(minutes, maxMinutes) {
  const t   = Math.max(0, Math.min(1, minutes / maxMinutes));
  const hue = 140 - 140 * t; // 140(초록) → 0(빨강)
  return { fill: hslToHex(hue, 70, 50), stroke: hslToHex(hue, 75, 40) };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
