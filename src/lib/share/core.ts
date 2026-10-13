// The browser side of Share, Download and Copy (Req 17), written so it can be tested without a
// browser: everything it touches (navigator, fetch, File, document) is passed in.
//
// createShareKit and bindShareDom must stay SELF-CONTAINED (no imports, no outside names): the
// no-login "ready" page has no React, so src/lib/share/page-script.ts sends their source text to
// the browser as an inline script. The React component (src/components/share/share-buttons.tsx)
// uses the same createShareKit, so there is one implementation.
//
// Rules: feature-detect only (the one user-agent check is for the iPhone hint); a cancelled share
// sheet (AbortError) is not an error; the caption is copied before the share sheet opens because
// some apps drop the text when a file is shared.

export interface ShareNavigator {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; text?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
  userAgent?: string;
}

export interface ShareDocument {
  createElement: (tag: string) => {
    value: string;
    style: Record<string, string>;
    setAttribute: (name: string, value: string) => void;
    select: () => void;
    setSelectionRange?: (a: number, b: number) => void;
  };
  body: { appendChild: (el: unknown) => unknown; removeChild: (el: unknown) => unknown };
  execCommand?: (cmd: string) => boolean;
}

export interface ShareEnv {
  navigator: ShareNavigator;
  fetch: (url: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>;
  File: new (parts: BlobPart[], name: string, opts?: { type?: string }) => File;
  document?: ShareDocument;
}

export type ShareOutcome =
  | { kind: 'shared'; copied: boolean }
  /** The owner closed the share sheet. Say nothing. */
  | { kind: 'cancelled'; copied: boolean }
  /** This browser cannot share files: offer Download. */
  | { kind: 'unsupported'; copied: boolean }
  /** `name` is the error name, for example NotAllowedError (the tap was too long ago). */
  | { kind: 'error'; copied: boolean; name: string };

export function createShareKit(env: ShareEnv) {
  const nav = env.navigator;

  /**
   * True when this browser can share a picture file. Checked with a real 1x1 PNG File, because some
   * desktop browsers have navigator.share but refuse files (H-11). Share and Share as story show
   * only when this is true; Download and Copy lead otherwise.
   */
  const canShareFiles = (): boolean => {
    try {
      if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false;
      // prettier-ignore
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 96, 248, 95, 15, 0, 2, 135, 1, 128, 235, 71, 186, 146, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
      return nav.canShare({ files: [new env.File([png], 'probe.png', { type: 'image/png' })] }) === true;
    } catch {
      return false;
    }
  };

  /** Copies text: the clipboard API, else a hidden textarea and execCommand. Never throws. */
  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        await nav.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to the textarea
    }
    try {
      const doc = env.document;
      if (!doc || typeof doc.execCommand !== 'function') return false;
      const area = doc.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.opacity = '0';
      doc.body.appendChild(area);
      area.select();
      if (area.setSelectionRange) area.setSelectionRange(0, text.length);
      const ok = doc.execCommand('copy') === true;
      doc.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  };

  /** Fetches the picture (same origin) and makes a File of the right type. Null when it cannot be had. */
  const prepare = async (url: string, filename: string): Promise<File | null> => {
    try {
      const res = await env.fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const blob = await res.blob();
      const type = blob.type && blob.type.indexOf('image/') === 0 ? blob.type : /\.jpe?g$/i.test(filename) ? 'image/jpeg' : 'image/png';
      return new env.File([blob], filename, { type });
    } catch {
      return null;
    }
  };

  /**
   * Copies the caption (started first, not awaited, so the tap is still fresh), then opens the
   * share sheet with the picture and the text.
   */
  const share = async (file: File, text: string): Promise<ShareOutcome> => {
    const copying = copyText(text);
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !nav.canShare({ files: [file] })) {
      return { kind: 'unsupported', copied: await copying };
    }
    try {
      await nav.share({ files: [file], text });
      return { kind: 'shared', copied: await copying };
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : 'Error';
      const copied = await copying;
      return name === 'AbortError' ? { kind: 'cancelled', copied } : { kind: 'error', copied, name };
    }
  };

  /** Only for the hint "On iPhone, tap Share, then choose the app". Not used to decide what works. */
  const isIos = (): boolean => /iPad|iPhone|iPod/.test(nav.userAgent || '');

  return { canShareFiles, copyText, prepare, share, isIos };
}

export type ShareKit = ReturnType<typeof createShareKit>;

/** The words the page script shows. */
export interface ShareDomText {
  copied: string;
  pasteHint: string;
  copyFailed: string;
  imageFailed: string;
  shareFailed: string;
  tapAgain: string;
  preparing: string;
}

/**
 * Wires up the buttons of the no-login "ready" page (plain HTML with data attributes; see
 * src/lib/approvals/link-handlers.ts). Browser only. `win` is the window; `createKit` is
 * createShareKit; `text` is the words to show.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindShareDom(createKit: (env: ShareEnv) => ShareKit, win: any, text: ShareDomText): void {
  const doc = win.document;
  const kit = createKit({
    navigator: win.navigator,
    fetch: (u: string, i?: Record<string, unknown>) => win.fetch(u, i),
    File: win.File,
    document: doc,
  });
  const canShare = kit.canShareFiles();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const each = (root: any, sel: string, fn: (el: any) => void) => {
    const list = root.querySelectorAll(sel);
    for (let i = 0; i < list.length; i++) fn(list[i]);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  each(doc, '[data-share-root]', (root: any) => {
    const post = root.getAttribute('data-post');
    const caption = root.getAttribute('data-text') || '';
    const token = root.getAttribute('data-token');
    const nonce = root.getAttribute('data-nonce');
    const say = (msg: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      each(root, '[data-share-msg]', (el: any) => {
        el.textContent = msg;
        el.hidden = !msg;
      });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const showPrompt = () => each(root, '[data-share-prompt]', (el: any) => (el.hidden = false));
    // Tell the server. A failed log must never get in the owner's way.
    const log = (kind: string, format: string, story: string) => {
      try {
        const form = new win.FormData();
        form.set('nonce', nonce);
        form.set('op', 'log');
        form.set('kind', kind);
        form.set('post', post);
        form.set('format', format || '');
        if (story) form.set('story', '1');
        win.fetch('/e/' + token, { method: 'POST', body: form, credentials: 'same-origin' }).catch(() => undefined);
      } catch {
        // ignore
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-js-only]', (el: any) => (el.hidden = false));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-needs-share]', (el: any) => (el.hidden = !canShare));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-no-share]', (el: any) => (el.hidden = canShare));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-ios-hint]', (el: any) => (el.hidden = !(canShare && kit.isIos())));

    const files: Record<string, Promise<File | null>> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fileFor = (btn: any): Promise<File | null> => {
      const url = btn.getAttribute('data-url');
      if (!files[url]) {
        files[url] = kit.prepare(url, btn.getAttribute('data-filename')).then((f) => {
          if (!f) delete files[url];
          return f;
        });
      }
      return files[url];
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-share-btn]', (btn: any) => {
      const warm = () => {
        if (canShare) void fileFor(btn);
      };
      btn.addEventListener('pointerdown', warm);
      btn.addEventListener('focus', warm);
      if (btn.getAttribute('data-default') === '1' && typeof win.IntersectionObserver === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const io = new win.IntersectionObserver((entries: any[]) => {
          if (entries.some((e) => e.isIntersecting)) {
            warm();
            io.disconnect();
          }
        });
        io.observe(btn);
      }
      btn.addEventListener('click', async () => {
        say('');
        const wasReady = btn.getAttribute('data-ready') === '1';
        const pending = fileFor(btn);
        if (!wasReady) say(text.preparing);
        const file = await pending;
        if (!file) {
          say(text.imageFailed);
          return;
        }
        btn.setAttribute('data-ready', '1');
        const out = await kit.share(file, caption);
        say('');
        if (out.kind === 'shared') {
          if (out.copied) say(text.pasteHint);
          log('share', btn.getAttribute('data-format'), btn.getAttribute('data-story'));
          showPrompt();
        } else if (out.kind === 'error') {
          say(out.name === 'NotAllowedError' && !wasReady ? text.tapAgain : text.shareFailed);
        } else if (out.kind === 'unsupported') {
          say(text.shareFailed);
        }
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-copy-btn]', (btn: any) => {
      btn.addEventListener('click', async () => {
        const ok = await kit.copyText(caption);
        say(ok ? text.copied : text.copyFailed);
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    each(root, '[data-download-link]', (a: any) => {
      a.addEventListener('click', () => {
        log('download', a.getAttribute('data-format'), '');
        showPrompt();
      });
    });
  });
}
