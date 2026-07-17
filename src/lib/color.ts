// The app's accent color is user-customizable (picked from presets or a raw
// hex input), and used as a solid background behind icons/text in a bunch of
// places (play button, "Done", queue badge, etc). Those all used to hardcode
// black text/icons, which reads fine on the old Spotify-green default but
// goes low-contrast-and-muddy on darker accents like blue or purple presets
// (sapphire blue, for one, is well under the WCAG AA 4.5:1 threshold against
// black -- see the contrast math below). Rather than hardcode a color per
// accent, compute which of black/white actually reads better against
// *whatever* color is currently selected.
export function getContrastText(hex: string): '#000000' | '#ffffff' {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#000000';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const chan = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  // Relative luminance per WCAG 2.x -- standard sRGB -> luminance formula.
  const luminance = 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  // Contrast ratio of this color against pure black vs pure white; whichever
  // is higher is the more readable choice for text/icons drawn on top of it.
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}
