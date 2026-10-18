// Page-side init script: visible cursor dot + click ripple, and hides the Next.js dev indicator.
// The dot follows the real (trusted) mouse events that Playwright sends, so hover states work too.
// This function is serialised and run inside the page, so it must stay self-contained.
export function installCursor() {
  if (window.__wpCursor) return;
  window.__wpCursor = true;
  const SIZE = 26;
  const make = () => {
    if (document.getElementById("__wp_cursor_style")) return;
    const root = document.documentElement;
    if (!root) return;
    const style = document.createElement("style");
    style.id = "__wp_cursor_style";
    style.textContent = `
      nextjs-portal, #__next-build-watcher, [data-nextjs-toast], [data-nextjs-dev-tools-button] { display: none !important; }
      #__wp_cursor { position: fixed; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px; margin: -${SIZE / 2}px 0 0 -${SIZE / 2}px;
        border-radius: 50%; background: #e4572e; border: 3px solid #fff; box-sizing: border-box;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); pointer-events: none; z-index: 2147483647; opacity: 0; transition: opacity .2s, scale .12s; }
      #__wp_cursor.down { scale: .78; }
      .__wp_ripple { position: fixed; width: ${SIZE}px; height: ${SIZE}px; margin: -${SIZE / 2}px 0 0 -${SIZE / 2}px; border-radius: 50%;
        border: 3px solid rgba(228,87,46,.75); background: rgba(228,87,46,.18); pointer-events: none; z-index: 2147483646;
        animation: __wp_ripple .7s ease-out forwards; }
      @keyframes __wp_ripple { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
    `;
    const dot = document.createElement("div");
    dot.id = "__wp_cursor";
    root.append(style, dot);
    const place = (x, y) => {
      dot.style.transform = `translate(${x}px, ${y}px)`;
      dot.style.opacity = "1";
      try {
        sessionStorage.setItem("__wp_cur", JSON.stringify([x, y]));
      } catch {
        /* storage blocked: the cursor just starts hidden after a navigation */
      }
    };
    try {
      const saved = JSON.parse(sessionStorage.getItem("__wp_cur") || "null");
      if (saved) place(saved[0], saved[1]);
    } catch {
      /* ignore */
    }
    window.addEventListener("mousemove", (e) => place(e.clientX, e.clientY), true);
    window.addEventListener(
      "mousedown",
      (e) => {
        dot.classList.add("down");
        const r = document.createElement("div");
        r.className = "__wp_ripple";
        r.style.left = e.clientX + "px";
        r.style.top = e.clientY + "px";
        root.append(r);
        setTimeout(() => r.remove(), 800);
      },
      true,
    );
    window.addEventListener("mouseup", () => dot.classList.remove("down"), true);
  };
  if (document.documentElement) make();
  document.addEventListener("DOMContentLoaded", make);
  window.addEventListener("load", () => setTimeout(make, 50));
}
