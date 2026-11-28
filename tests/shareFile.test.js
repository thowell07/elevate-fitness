import test from 'node:test';
import assert from 'node:assert/strict';
const { shareOrDownloadFile } = await import('../src/lib/shareFile.js');

const bytes = new Uint8Array([37, 80, 68, 70, 45]);
const args = { bytes, fileName: 'nutrition-report-2026-11-14-to-2026-11-27.pdf', mimeType: 'application/pdf', title: 'Nutrition report' };

const fakeDom = () => {
  const log = { clicks: [], created: [], revoked: [], appended: 0, removed: 0 };
  const document = {
    body: { appendChild: () => { log.appended += 1; } },
    createElement: (tag) => {
      assert.equal(tag, 'a');
      const link = { style: {}, click() { log.clicks.push({ href: this.href, download: this.download }); }, remove() { log.removed += 1; } };
      return link;
    },
  };
  const URL = { createObjectURL: (file) => { log.created.push(file); return 'blob:fake-1'; }, revokeObjectURL: (href) => log.revoked.push(href) };
  const setTimeout = (fn) => fn();
  return { log, env: { document, URL, setTimeout } };
};

test('shares the file through the share sheet when files can be shared', async () => {
  const { log, env } = fakeDom();
  let shared;
  const navigator = { canShare: ({ files }) => files[0] instanceof File, share: async (data) => { shared = data; } };
  assert.equal(await shareOrDownloadFile(args, { ...env, navigator }), 'shared');
  assert.equal(shared.title, 'Nutrition report');
  assert.equal(shared.files[0].name, args.fileName);
  assert.equal(shared.files[0].type, 'application/pdf');
  assert.deepEqual([...new Uint8Array(await shared.files[0].arrayBuffer())], [...bytes]);
  assert.equal(log.clicks.length, 0);
});

test('a dismissed share sheet reports cancelled and downloads nothing', async () => {
  const { log, env } = fakeDom();
  const navigator = { canShare: () => true, share: async () => { throw Object.assign(new Error('dismissed'), { name: 'AbortError' }); } };
  assert.equal(await shareOrDownloadFile(args, { ...env, navigator }), 'cancelled');
  assert.equal(log.clicks.length, 0);
});

test('NotAllowedError from share falls back to a download', async () => {
  const { log, env } = fakeDom();
  const navigator = { canShare: () => true, share: async () => { throw Object.assign(new Error('gesture'), { name: 'NotAllowedError' }); } };
  assert.equal(await shareOrDownloadFile(args, { ...env, navigator }), 'downloaded');
  assert.equal(log.clicks.length, 1);
});

test('downloads through a temporary object URL when files cannot be shared', async () => {
  for (const navigator of [{}, { share: async () => {}, canShare: () => false }, { share: async () => {} }, undefined]) {
    const { log, env } = fakeDom();
    assert.equal(await shareOrDownloadFile(args, { ...env, navigator }), 'downloaded');
    assert.deepEqual(log.clicks, [{ href: 'blob:fake-1', download: args.fileName }]);
    assert.equal(log.created[0].name, args.fileName);
    assert.deepEqual(log.revoked, ['blob:fake-1']);
    assert.equal(log.appended, 1); assert.equal(log.removed, 1);
  }
});

test('a canShare that throws is treated as no share support', async () => {
  const { env } = fakeDom();
  const navigator = { share: async () => {}, canShare: () => { throw new TypeError('bad'); } };
  assert.equal(await shareOrDownloadFile(args, { ...env, navigator }), 'downloaded');
});
