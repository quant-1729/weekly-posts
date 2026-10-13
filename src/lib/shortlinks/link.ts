// Pure helpers (no env, no database), safe to import in the browser.

/** The code in `/r/{code}`: 6 to 10 lowercase letters and digits, same as posts.post_code. */
export const POST_CODE_RE = /^[a-z0-9]{6,10}$/;

export function buildShortLink(baseUrl: string, postCode: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${postCode}`;
}
