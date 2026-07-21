// src/lib/print.js
//
// Single print strategy for the whole app. Every printable section renders
// via <PrintDocument id="..."> (className "print-only" + that id), always
// mounted in the DOM but hidden. To print one specific section, mark it
// (and only it) with the `is-printing` class; the @media print rule in
// index.css only shows `.print-only.is-printing`.
//
// This replaced three divergent print helpers that used to coexist:
// - components/print/printSection.js (dead, unused)
// - features/reports/utils/print.js (printId — set an unused `data-printing`
//   attribute on <html> that the CSS never actually read)
// - features/results/utils/print.js (printNow/printStudentSlip — same
//   no-op attribute approach, PLUS a totally separate popup-window printer
//   with its own hand-duplicated stylesheet for class results only)
// None of those correctly scoped "print exactly this section" once more
// than one .print-only block was mounted at once (e.g. the Results page,
// which mounts both the class-results and student-slip print blocks).

const PRINTING_CLASS = "is-printing";

export function printSection(id) {
  if (!id) return;

  const target = document.getElementById(id);
  if (!target) {
    alert(`Print area not found: #${id}`);
    return;
  }

  // Only one target should ever be marked at a time.
  document
    .querySelectorAll(`.${PRINTING_CLASS}`)
    .forEach((el) => el.classList.remove(PRINTING_CLASS));

  target.classList.add(PRINTING_CLASS);

  const cleanup = () => target.classList.remove(PRINTING_CLASS);
  window.addEventListener("afterprint", cleanup, { once: true });

  requestAnimationFrame(() => {
    window.print();
    // Fallback in case `afterprint` doesn't fire (some browsers / print-to-PDF flows).
    setTimeout(cleanup, 1000);
  });
}
