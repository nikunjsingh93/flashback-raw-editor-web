// Store already-encoded photos without recompressing or copying the entire roll.
const LIMIT = 0xffffffff;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function checkCancel(cancelled) {
  if (cancelled()) throw new DOMException('ZIP cancelled', 'AbortError');
}
async function crc32(file, cancelled) {
  let crc = 0xffffffff;
  for (let pos = 0; pos < file.size; pos += 1024 * 1024) {
    checkCancel(cancelled);
    const bytes = new Uint8Array(await file.slice(pos, pos + 1024 * 1024).arrayBuffer());
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    // Yield to let progress paint and the Cancel button respond.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkCancel(cancelled);
  return (crc ^ 0xffffffff) >>> 0;
}
function uniqueName(original, used) {
  const clean = (original || 'photo').replace(/[\\/]/g, '_').replace(/[\x00-\x1f]/g, '_');
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  let name = clean, index = 2;
  while (used.has(name.toLowerCase())) name = stem + ' (' + index++ + ')' + ext;
  used.add(name.toLowerCase());
  return name;
}
function dosDate(timestamp) {
  const d = new Date(timestamp || Date.now());
  const year = Math.max(1980, Math.min(2107, d.getFullYear()));
  return [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)),
    ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}
/** Create a single ZIP File. Supports UTF-8 names, duplicates and cancellation. */
export async function createZipFile(files, { name = 'flashback-photos.zip', onProgress = () => {}, cancelled = () => false } = {}) {
  if (!files.length) throw new Error('No photos to ZIP');
  if (files.length > 65535) throw new Error('Too many photos in one ZIP. Export a smaller batch.');
  const entries = [], used = new Set();
  let offset = 0, centralSize = 0;
  // Validate the ZIP32 limits before reading any photo bytes.
  for (const file of files) {
    const bytes = encoder.encode(uniqueName(file.name, used));
    if (bytes.length > 65535 || file.size > LIMIT) throw new Error('Photo is too large for ZIP. Export a smaller batch.');
    entries.push({ file, bytes, offset });
    offset += 30 + bytes.length + file.size;
    centralSize += 46 + bytes.length;
  }
  if (offset + centralSize + 22 > LIMIT) throw new Error('ZIP would exceed 4 GB. Export a smaller batch.');
  const parts = [], central = [];
  for (let i = 0; i < entries.length; i++) {
    checkCancel(cancelled);
    onProgress(i, entries.length, entries[i].file.name);
    const { file, bytes, offset: entryOffset } = entries[i];
    const crc = await crc32(file, cancelled);
    const [time, date] = dosDate(file.lastModified);
    const header = new Uint8Array(30 + bytes.length), local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8; stored, no compression
    local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.size, true); local.setUint32(22, file.size, true);
    local.setUint16(26, bytes.length, true); header.set(bytes, 30);
    const directory = new Uint8Array(46 + bytes.length), dir = new DataView(directory.buffer);
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, time, true); dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true); dir.setUint32(20, file.size, true); dir.setUint32(24, file.size, true);
    dir.setUint16(28, bytes.length, true); dir.setUint32(42, entryOffset, true); directory.set(bytes, 46);
    parts.push(header, file); central.push(directory);
  }
  checkCancel(cancelled);
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true); view.setUint16(10, files.length, true);
  view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  onProgress(files.length, files.length);
  return new File([...parts, ...central, end], name, { type: 'application/zip' });
}
