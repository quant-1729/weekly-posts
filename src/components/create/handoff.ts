// Home hands the owner's first words to the Details step of "Create a post". They go through sessionStorage, not the
// URL, so the text never lands in a link, the browser history or a server log. The editor reads it once and clears it.

export const HOME_DESCRIPTION_KEY = "wp:home-description";

/** Keeps the text for the next page. A browser with storage switched off just loses the head start. */
export function stashDescription(text: string): void {
  try {
    window.sessionStorage.setItem(HOME_DESCRIPTION_KEY, text);
  } catch {
    // Private mode or storage off: the owner can type it again on the next page.
  }
}

/** Returns the stashed text and clears it, or null. */
export function takeDescription(): string | null {
  try {
    const text = window.sessionStorage.getItem(HOME_DESCRIPTION_KEY);
    if (text === null) return null;
    window.sessionStorage.removeItem(HOME_DESCRIPTION_KEY);
    return text.trim() === "" ? null : text;
  } catch {
    return null;
  }
}
