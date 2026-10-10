import test from 'node:test';
import assert from 'node:assert/strict';
import { createZipFile } from '../src/ui/zip.js';
import { unzipSync, strFromU8 } from 'fflate';

// Extract with an independent ZIP reader and verify byte-for-byte content.
test('ZIP extracts exact bytes, duplicate names, empty files and multi-chunk data', async () => {
  const bytes = Uint8Array.from({ length: 2300000 }, (_, i) => i % 251);
  const progress = [];
  const files = [new File(['123456789'], 'photo.jpg'), new File([bytes], 'photo.jpg'),
    new File(['UTF-8 content'], 'café-日本.tiff'), new File([], 'empty.jpg')];
  const zip = await createZipFile(files, { onProgress: (done, total) => progress.push([done,total]) });
  assert.equal(zip.type, 'application/zip');
  assert.equal(zip.name, 'flashback-photos.zip');
  assert.deepEqual(progress.at(-1), [4,4]);
  const packed = new Uint8Array(await zip.arrayBuffer());
  const extracted = unzipSync(packed);
  assert.deepEqual(Object.keys(extracted), ['photo.jpg', 'photo (2).jpg', 'café-日本.tiff', 'empty.jpg']);
  assert.equal(strFromU8(extracted['photo.jpg']), '123456789');
  assert.equal(new DataView(packed.buffer).getUint32(14, true), 0xcbf43926);
  assert.deepEqual(extracted['photo (2).jpg'], bytes);
  assert.equal(strFromU8(extracted['café-日本.tiff']), 'UTF-8 content');
  assert.equal(extracted['empty.jpg'].length, 0);
});
test('Cancel interrupts packing between chunks', async () => {
  let cancelled = false;
  const file = new File([new Uint8Array(3000000)], 'large.jpg');
  setTimeout(() => { cancelled = true; }, 0);
  await assert.rejects(createZipFile([file], { cancelled: () => cancelled }), { name: 'AbortError' });
});
test('Empty batches and ZIP32 overflow produce actionable errors before reading', async () => {
  await assert.rejects(createZipFile([]), /No photos/);
  await assert.rejects(createZipFile([{name:'huge.tiff',size:0xffffffff}]), /4 GB/);
  await assert.rejects(createZipFile(Array(65536)), /Too many/);
});
