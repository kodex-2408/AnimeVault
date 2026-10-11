'use strict';

// Builds small but structurally real MOBI 6 files for the reader tests: a
// PalmDB header and record list, record 0 with the PalmDOC + MOBI headers and
// an EXTH block (cover / thumbnail), PalmDOC-compressed text records with
// trailing entries, image records and the closing FLIS / EOF records.

// PalmDOC compression: literal runs plus a back-reference when the next 3-10
// bytes already appeared within the last 2047 bytes.
function palmDocCompress(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    let bestLen = 0, bestDist = 0;
    for (let d = 1; d <= Math.min(i, 2047); d++) {
      let len = 0;
      while (len < 10 && i + len < src.length && src[i + len - d] === src[i + len]) len++;
      if (len > bestLen) { bestLen = len; bestDist = d; }
    }
    if (bestLen >= 3) {
      const x = 0x8000 | (bestDist << 3) | (bestLen - 3);
      out.push(x >> 8, x & 0xFF);
      i += bestLen;
      continue;
    }
    const c = src[i];
    if (c === 0x20 && i + 1 < src.length && src[i + 1] >= 0x40 && src[i + 1] <= 0x7F) { out.push(src[i + 1] ^ 0x80); i += 2; continue; }
    if (c === 0 || (c >= 0x09 && c <= 0x7F)) { out.push(c); i++; continue; }
    const run = [];
    while (i < src.length && run.length < 8 && !(src[i] === 0 || (src[i] >= 0x09 && src[i] <= 0x7F))) run.push(src[i++]);
    out.push(run.length, ...run);
  }
  return Buffer.from(out);
}

function buildMobi({ html, images = [], coverIndex = -1, thumbIndex = -1, compression = 2 }) {
  const text = Buffer.from(html, 'utf8');
  const textRecords = [];
  for (let p = 0; p < text.length; p += 4096) {
    const chunk = text.subarray(p, p + 4096);
    const body = compression === 2 ? palmDocCompress(chunk) : chunk;
    // trailing data: multibyte flag (1 byte, value 0 = just itself) then a
    // 3-byte entry whose last byte holds its size with the stop bit
    textRecords.push(Buffer.concat([body, Buffer.from([0x00]), Buffer.from([0xAA, 0xBB, 0x83])]));
  }
  const exthRecs = [];
  const exthNum = (type, v) => { const b = Buffer.alloc(12); b.writeUInt32BE(type, 0); b.writeUInt32BE(12, 4); b.writeUInt32BE(v, 8); exthRecs.push(b); };
  if (coverIndex >= 0) exthNum(201, coverIndex);
  if (thumbIndex >= 0) exthNum(202, thumbIndex);
  const exthBody = Buffer.concat(exthRecs);
  const exth = Buffer.alloc(12);
  exth.write('EXTH', 0, 'latin1'); exth.writeUInt32BE(12 + exthBody.length, 4); exth.writeUInt32BE(exthRecs.length, 8);
  const mobiHeaderLen = 0xE8;
  const r0 = Buffer.alloc(16 + mobiHeaderLen);
  r0.writeUInt16BE(compression, 0);
  r0.writeUInt32BE(text.length, 4);
  r0.writeUInt16BE(textRecords.length, 8);
  r0.writeUInt16BE(4096, 10);
  r0.write('MOBI', 16, 'latin1');
  r0.writeUInt32BE(mobiHeaderLen, 20);
  r0.writeUInt32BE(2, 24);          // book
  r0.writeUInt32BE(65001, 28);      // UTF-8
  const firstImage = 1 + textRecords.length;
  r0.writeUInt32BE(images.length ? firstImage : 0xFFFFFFFF, 0x6C);
  r0.writeUInt32BE(0x40, 0x80);     // has EXTH
  r0.writeUInt16BE(0x3, 0xF2);      // multibyte + one trailing entry
  const record0 = Buffer.concat([r0, exth, Buffer.concat([exthBody, Buffer.alloc((4 - exthBody.length % 4) % 4)])]);
  const flis = Buffer.from('FLIS\0\0\0\x08', 'latin1');
  const eof = Buffer.from([0xE9, 0x8E, 0x0D, 0x0A]);
  const records = [record0, ...textRecords, ...images, flis, eof];
  const header = Buffer.alloc(78 + records.length * 8 + 2);
  header.write('Test book', 0, 'latin1');
  header.write('BOOKMOBI', 60, 'latin1');
  header.writeUInt16BE(records.length, 76);
  let off = header.length;
  records.forEach((r, i) => { header.writeUInt32BE(off, 78 + i * 8); header.writeUInt32BE(i * 2, 78 + i * 8 + 4); off += r.length; });
  return Buffer.concat([header, ...records]);
}

// Distinct tiny images: a PNG and JPEG-shaped records (the reader sniffs the
// first bytes; it never decodes them).
function fakeJpeg(tag) { return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from(String(tag)), Buffer.from([0xFF, 0xD9])]); }

module.exports = { buildMobi, palmDocCompress, fakeJpeg };
