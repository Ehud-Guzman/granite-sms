// src/features/reports/utils/print.js
export function printId(id) {
  const el = document.getElementById(id);
  if (!el) {
    alert(`Print area not found: #${id}`);
    return;
  }

  const html = document.documentElement;
  const prev = html.dataset.printing;

  html.dataset.printing = id;

  const cleanup = () => {
    if (prev) html.dataset.printing = prev;
    else delete html.dataset.printing;
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  requestAnimationFrame(() => {
    window.print();
    setTimeout(cleanup, 800);
  });
}
