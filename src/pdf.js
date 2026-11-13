// Minimal PDF writer for text reports (A4, Helvetica, headings, paragraphs, tables with page breaks).
// The output is pure ASCII (non-ASCII characters as octal escapes in WinAnsi encoding), so it can be saved
// as a text file everywhere: browser download, the Android app's file bridge and the artifact downloads.

// glyph widths (1/1000 em) of Helvetica and Helvetica-Bold for ASCII 32..126
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const EXTRA = { 'Ä': [667, 722], 'Ö': [778, 778], 'Ü': [722, 722], 'ä': [556, 556], 'ö': [556, 611], 'ü': [556, 611], 'ß': [611, 611], '€': [556, 556], '§': [556, 556], '–': [556, 556], '—': [1000, 1000], '·': [278, 278], '…': [1000, 1000], '„': [333, 500], '“': [333, 500], '”': [333, 500], '×': [584, 584], '°': [400, 400], ' ': [278, 278] };
// WinAnsi codes 0x80..0x9F that differ from Latin-1
const WIN = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

const code = (ch) => {
  const c = ch.codePointAt(0);
  if (c >= 32 && c < 127) return c;
  if (WIN[ch]) return WIN[ch];
  if (c >= 0xa0 && c <= 0xff) return c;
  if (c === 0x202f || c === 0x2009) return 32;
  return 63; // '?'
};

export function textWidth(text, size, bold = false) {
  let w = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c < 127 ? (bold ? BOLD : REG)[c - 32] : EXTRA[ch] ? EXTRA[ch][bold ? 1 : 0] : 556;
  }
  return (w * size) / 1000;
}

const pdfStr = (text) => {
  let out = '(';
  for (const ch of String(text)) {
    const c = code(ch);
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c >= 32 && c < 127) out += String.fromCharCode(c);
    else out += '\\' + c.toString(8).padStart(3, '0');
  }
  return out + ')';
};

// split into lines no wider than maxW (long words are cut)
export function wrapText(text, maxW, size, bold = false) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? line + ' ' + word : word;
      if (textWidth(cand, size, bold) <= maxW) {
        line = cand;
        continue;
      }
      if (line) out.push(line);
      let w = word;
      while (textWidth(w, size, bold) > maxW && w.length > 1) {
        let k = w.length - 1;
        while (k > 1 && textWidth(w.slice(0, k), size, bold) > maxW) k--;
        out.push(w.slice(0, k));
        w = w.slice(k);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

const PAGE_W = 595.28,
  PAGE_H = 841.89,
  M = 48;
const n2 = (v) => (Math.round(v * 100) / 100).toString();

// blocks: {t:'title'|'h'|'p'|'small', text} · {t:'gap'} · {t:'table', cols:[{w, right}], head:[], rows:[[]], foot:[]}
export function buildPdf(blocks, { title = 'Bericht', footer = '' } = {}) {
  const pages = [];
  let ops = [];
  let y = PAGE_H - M;
  const bottom = M + 24;
  const newPage = () => {
    if (ops.length) pages.push(ops);
    ops = [];
    y = PAGE_H - M;
  };
  const text = (x, yy, s, size, bold, gray) => {
    ops.push(`${gray ? '0.42 g' : '0.1 g'} BT /${bold ? 'F2' : 'F1'} ${n2(size)} Tf 1 0 0 1 ${n2(x)} ${n2(yy)} Tm ${pdfStr(s)} Tj ET`);
  };
  const rule = (x1, x2, yy, gray = 0.8, w = 0.5) => ops.push(`${gray} G ${w} w ${n2(x1)} ${n2(yy)} m ${n2(x2)} ${n2(yy)} l S`);
  const need = (h) => {
    if (y - h < bottom) newPage();
  };
  const para = (s, size, bold, gray, lead, before = 0) => {
    y -= before;
    for (const l of wrapText(s, PAGE_W - 2 * M, size, bold)) {
      need(lead);
      y -= lead;
      text(M, y + (lead - size) / 2 + 1, l, size, bold, gray);
    }
  };
  for (const b of blocks) {
    if (b.t === 'title') para(b.text, 16, true, false, 21);
    else if (b.t === 'h') {
      need(40);
      para(b.text, 11, true, false, 15, 12);
      y -= 2;
    } else if (b.t === 'p') para(b.text, 9.5, false, false, 12.5, 2);
    else if (b.t === 'small') para(b.text, 7.8, false, true, 10.2, 2);
    else if (b.t === 'gap') y -= 8;
    else if (b.t === 'table') {
      const avail = PAGE_W - 2 * M;
      const sum = b.cols.reduce((s, c) => s + c.w, 0);
      const ws = b.cols.map((c) => (c.w / sum) * avail);
      const xs = ws.map((_, k) => M + ws.slice(0, k).reduce((s, v) => s + v, 0));
      const size = 8.4,
        lead = 10.6,
        pad = 3;
      const row = (cells, bold, gray) => {
        const lines = cells.map((c, k) => wrapText(c, ws[k] - 2 * pad, size, bold));
        const h = Math.max(1, ...lines.map((l) => l.length)) * lead + 2 * pad;
        return { lines, h, bold, gray };
      };
      const draw = (r) => {
        r.lines.forEach((ls, k) =>
          ls.forEach((l, j) => {
            const yy = y - pad - (j + 1) * lead + (lead - size) / 2 + 1;
            const x = b.cols[k].right ? xs[k] + ws[k] - pad - textWidth(l, size, r.bold) : xs[k] + pad;
            text(x, yy, l, size, r.bold, r.gray);
          }),
        );
        y -= r.h;
      };
      const head = b.head ? row(b.head, true, true) : null;
      const drawHead = () => {
        if (!head) return;
        draw(head);
        rule(M, M + avail, y, 0.35, 0.8);
      };
      y -= 4;
      need((head?.h || 0) + 20);
      drawHead();
      for (const cells of b.rows || []) {
        const r = row(cells, false, false);
        if (y - r.h < bottom) {
          newPage();
          drawHead();
        }
        draw(r);
        rule(M, M + avail, y, 0.86, 0.4);
      }
      if (b.foot) {
        const r = row(b.foot, true, false);
        need(r.h + 2);
        rule(M, M + avail, y, 0.35, 0.8);
        draw(r);
      }
      y -= 6;
    }
  }
  newPage();
  // page footer: report name and page numbers
  const N = pages.length;
  pages.forEach((p, k) => {
    const f = `${footer || title} · Seite ${k + 1} von ${N}`;
    p.push(`0.55 g BT /F1 7.5 Tf 1 0 0 1 ${n2(M)} ${n2(M - 14)} Tm ${pdfStr(f)} Tj ET`);
  });

  // objects: 1 catalog, 2 pages, 3/4 fonts, 5 info, then page + content per page
  const objs = [];
  const kids = pages.map((_, k) => `${6 + k * 2} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${N} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[5] = `<< /Title ${pdfStr(title)} /Producer (Hausakte) >>`;
  pages.forEach((p, k) => {
    const content = p.join('\n');
    objs[6 + k * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(PAGE_W)} ${n2(PAGE_H)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + k * 2} 0 R >>`;
    objs[7 + k * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offs = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
