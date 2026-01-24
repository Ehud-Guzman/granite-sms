export function printTarget(targetKey) {
  const html = document.documentElement;

  // set whitelist
  html.dataset.printing = targetKey;

  const cleanup = () => {
    // remove whitelist
    delete html.dataset.printing;
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);

  // let React paint first
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}
