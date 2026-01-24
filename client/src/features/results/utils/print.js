// src/features/results/utils/print.js

/**
 * Print a specific section by id using CSS-driven visibility.
 * Works with popup blockers (no window.open).
 *
 * Requires global CSS that reads html[data-printing="..."].
 */
export function printSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) {
    alert("Nothing to print yet. Open the results first.");
    return;
  }

  // set which section to print (CSS will show only this)
  document.documentElement.setAttribute("data-printing", sectionId);

  // print after DOM updates
  setTimeout(() => {
    const cleanup = () => {
      document.documentElement.removeAttribute("data-printing");
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);

    window.print();

    // fallback cleanup if afterprint doesn't fire
    setTimeout(cleanup, 1200);
  }, 80);
}

/**
 * Backwards-compatible helper:
 * If you call printNow("print-student-slip") it prints that section.
 * If you call printNow() it defaults to printing the class results.
 */
export function printNow(sectionId = "print-class-results") {
  printSection(sectionId);
}

export function printClassResults() {
  printSection("print-class-results");
}

export function printStudentSlip() {
  printSection("print-student-slip");
}
