export function printSection(key) {
  const html = document.documentElement;
  const prev = html.getAttribute("data-printing");

  html.setAttribute("data-printing", key);

  // give React a tick to render the print node
  setTimeout(() => {
    window.print();

    // cleanup after print
    setTimeout(() => {
      if (prev) html.setAttribute("data-printing", prev);
      else html.removeAttribute("data-printing");
    }, 250);
  }, 50);
}
