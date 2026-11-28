// Hands a generated file to the iOS share sheet when the browser can share files, otherwise downloads it.
// navigator, document, URL and File are injectable so this runs under node:test.

const download = ({ file, fileName }, { document: doc, URL: url, setTimeout: later }) => {
  const href = url.createObjectURL(file);
  try {
    const link = doc.createElement('a');
    link.href = href;
    link.download = fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body?.appendChild(link);
    link.click();
    link.remove?.();
  } finally {
    // Revoke after the click has been handled; revoking synchronously can cancel the download in Safari.
    later(() => url.revokeObjectURL(href), 1000);
  }
  return 'downloaded';
};

export async function shareOrDownloadFile({ bytes, fileName, mimeType = 'application/pdf', title } = {}, env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const deps = { document: env.document ?? globalThis.document, URL: env.URL ?? globalThis.URL, setTimeout: env.setTimeout ?? globalThis.setTimeout };
  const FileCtor = env.File ?? globalThis.File;
  const file = new FileCtor([bytes], fileName, { type: mimeType });

  // No await between here and navigator.share: iOS only allows the share sheet inside the tap's activation.
  let canShare = false;
  try { canShare = Boolean(nav?.share && nav.canShare?.({ files: [file] })); } catch { canShare = false; }
  if (canShare) {
    try {
      await nav.share({ files: [file], title: title || fileName });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (the tap's allowance ran out) or any other share failure: download instead.
    }
  }
  return download({ file, fileName }, deps);
}
