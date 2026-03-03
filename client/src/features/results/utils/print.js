// src/features/results/utils/print.js

/**
 * Print class results in a new window — fully polished
 */
export function printClassResults() {
  const printContainer = document.getElementById("print-class-results");
  if (!printContainer) {
    alert("Results not loaded yet. Please wait a moment and try again.");
    return;
  }

  // Clone and remove interactive elements
  const printContent = printContainer.cloneNode(true);
  printContent.querySelectorAll("button, select, input, textarea").forEach(el => el.remove());

  const printWindow = window.open("", "", "height=900,width=1200,scrollbars=yes");
  if (!printWindow) {
    alert("Popup blocked. Allow popups and try again.");
    return;
  }

  const footerText = printContainer.dataset.footerText || "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Class Results</title>
        <meta charset="UTF-8" />
        <style>
          @page {
            size: A4 landscape;
            margin: 10mm 8mm 12mm 8mm;
          }
          html, body {
            margin: 0;
            padding: 0;
            font-family: Arial, Helvetica, sans-serif;
            color: #000;
            background: #fff;
            font-size: 10pt;
            width: 100%;
          }

          .print-wrapper {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }

          .print-doc {
            flex: 1 0 auto;
          }

          .print-letterhead {
            text-align: center;
            margin-bottom: 10mm;
            page-break-after: avoid;
          }
          .print-letterhead__logo {
            max-height: 60px;
            display: block;
            margin: 0 auto 5px auto;
          }
          .print-letterhead__schoolName {
            font-size: 18pt;
            font-weight: bold;
            margin-bottom: 3mm;
          }
          .print-letterhead__headerText {
            font-size: 10pt;
            margin-bottom: 2mm;
          }
          .print-letterhead__rule {
            border-top: 1px solid #000;
            margin-top: 3mm;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            page-break-inside: auto;
          }

          th, td {
            border: 1px solid #000;
            padding: 4px 6px;
            font-size: 9pt;
            word-wrap: break-word;
          }

          th {
            background: #eee;
            font-weight: bold;
          }

          tr {
            page-break-inside: avoid;
          }

          td:nth-child(2) {
            text-align: left;
          }

          .print-footer {
            flex-shrink: 0;
            margin-top: auto;
            text-align: center;
            font-size: 9pt;
            color: #333;
            border-top: 1px solid #000;
            padding-top: 4mm;
          }

          .print-footer__text {
            margin-top: 2mm;
          }

          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 12mm;
            font-size: 10pt;
          }
          .signatures div {
            width: 40%;
            text-align: center;
          }
          .signatures div .line {
            border-top: 1px solid #000;
            width: 80%;
            margin: 2mm auto 0 auto;
            padding-top: 2mm;
          }
        </style>
      </head>
      <body onload="window.print(); setTimeout(() => window.close(), 800);">
        <div class="print-wrapper">
          ${printContent.outerHTML}

          <div class="print-footer">
            <div class="signatures">
              <div><div class="line">Class Teacher / Exam Teacher</div></div>
              <div><div class="line">Principal / Headteacher</div></div>
            </div>
            <div class="print-footer__text">${footerText}</div>
          </div>
        </div>
      </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}

export function printNow(sectionId = "print-class-results") {
  if (sectionId === "print-class-results") {
    printClassResults();
  } else {
    document.documentElement.setAttribute("data-printing", sectionId);
    setTimeout(() => window.print(), 300);
  }
}

export function printStudentSlip() {
  document.documentElement.setAttribute("data-printing", "print-student-slip");
  setTimeout(() => window.print(), 300);
}