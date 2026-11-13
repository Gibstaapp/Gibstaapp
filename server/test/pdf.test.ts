import { describe, expect, it } from 'vitest';
import { pdfDate, pdfLinks, pdfToText, tooOld } from '../src/beer/pdf.ts';
import { parseEuroPrices, parsePrices } from '../src/beer/extract.ts';
import { dedupePrices } from '../src/beer/rank.ts';

/** A tiny real PDF: one page, Helvetica, each [x, y, text] drawn where given. € is byte 0x80 in WinAnsi. */
function makePdf(lines: [number, number, string][], date = "D:20250512125523+03'00'"): Uint8Array {
  const enc = (s: string) => s.replace(/€/g, '\x80').replace(/[()\\]/g, (c) => '\\' + c);
  const content = 'BT /F1 11 Tf ' + lines.map(([x, y, t]) => `1 0 0 1 ${x} ${y} Tm (${enc(t)}) Tj`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /CreationDate (${date}) >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

describe('PDF menus', () => {
  it('reads the text in rows, so each price stays with its beer, and takes the menu date', async () => {
    // Columns written out of order on purpose: the reader must line them up by position.
    const pdf = makePdf([[400, 700, '€7,00'], [300, 700, '500ml'], [60, 700, 'Stella Artois draft'], [60, 680, 'Corona'], [300, 680, '330ml'], [400, 680, '€7,00'], [60, 740, 'BEERS']]);
    const t = await pdfToText(pdf, null);
    expect(t).toMatchObject({ ocr: false, menuDate: '2025-05', pages: 1 });
    expect(t!.text).toContain('Stella Artois draft  500ml  €7,00');
    expect(parseEuroPrices(t!.text, false).map((p) => `${p.item}|${p.size}|${p.price}`)).toEqual(['Stella Artois draft|500ml|7', 'Corona|330ml|7']);
  });
  it('dollar menus too (San Diego)', async () => {
    const t = await pdfToText(makePdf([[60, 700, 'Draft Beers'], [60, 680, 'Coors Light - $5.00'], [60, 660, 'House IPA - $7.00']]), null);
    expect(parsePrices(t!.text, false).map((p) => `${p.item}|${p.price}`)).toEqual(['Coors Light|5', 'House IPA|7']);
  });
  it('picks menu PDFs on the same site, never grant posters', () => {
    const html = `<a href="/wp-content/uploads/2024/05/BEER-MENU-english.pdf">Beer menu</a>
      <a href="/files/ΕΣΠΑ-ΑΦΙΣΑ.pdf">ΕΣΠΑ</a> <a href="https://other.com/menu.pdf">x</a>
      <a href="/uploads/healthfirstsign.pdf">Health</a> <a href="/menu2026.pdf">Menu</a>
      <a href="/wp-content/uploads/2025/11/sdut_10.10.pdf">In the news</a> <a href="/files/floorplan.pdf">Floor plan</a>`;
    expect(pdfLinks(html, 'https://enaithria.gr/')).toEqual(['https://enaithria.gr/wp-content/uploads/2024/05/BEER-MENU-english.pdf', 'https://enaithria.gr/menu2026.pdf']);
  });
  it('menus more than 2 years old are not read', async () => {
    expect(tooOld('2021-11', new Date(2026, 10, 13))).toBe(true);
    expect(tooOld('2025-05', new Date(2026, 10, 13))).toBe(false); // 18 months
    expect(tooOld('2024-05', new Date(2026, 10, 13))).toBe(true);  // 30 months
    expect(tooOld(undefined)).toBe(false);
    const old = await pdfToText(makePdf([[60, 700, 'Stella Artois draft  500ml  €7,00']], 'D:20211111120000'), null);
    expect(old?.text).toBe('');
  });
  it('menu dates', () => {
    expect(pdfDate("D:20240529111559")).toBe('2024-05');
    expect(pdfDate("D:20250512125523+03'00'")).toBe('2025-05');
    expect(pdfDate(undefined)).toBeUndefined();
    expect(pdfDate('garbage')).toBeUndefined();
  });
  it('a price found by hand and in their PDF shows once (the hand-checked one)', () => {
    const p = (id: string, source: any, item: string) => ({ id, venueId: 'v', item, price: 7, size: '500ml', currency: 'EUR' as const, kind: 'regular' as const, source, reportedAt: '' });
    expect(dedupePrices([p('w', 'website', 'Stella Artois draft'), p('s', 'seed', 'Stella Artois (draft)')]).map((x) => x.id)).toEqual(['s']);
  });
});
