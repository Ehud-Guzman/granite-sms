import { money } from "../components/FeeMoney";
import PrintDocument from "../../../components/print/PrintDocument";

function fmtDate(d) {
  try {
    return d ? new Date(d).toLocaleString() : "";
  } catch {
    return "";
  }
}

// Normalize backend receipt JSON → stable print model
function normalizeReceipt(raw) {
  const r = raw || {};

  const studentName =
    r.student?.name ||
    `${r.student?.firstName || ""} ${r.student?.lastName || ""}`.trim() ||
    r.studentName ||
    "—";

  const admissionNo = r.student?.admissionNo || r.admissionNo || "—";

  const className =
    r.class?.name
      ? `${r.class.name}${r.class.stream ? ` ${r.class.stream}` : ""}`
      : r.className || "—";

  const receiptNo = r.payment?.receiptNo || r.receiptNo || "—";
  const createdAt =
    r.payment?.receivedAt ||
    r.payment?.createdAt ||
    r.receivedAt ||
    r.createdAt ||
    null;

  const amount = Number(r.payment?.amount ?? r.amount ?? 0);
  const method = r.payment?.method || r.method || "—";
  const reference = r.payment?.reference || r.reference || "";

  const year = r.invoice?.year ?? r.year ?? "";
  const term = r.invoice?.term ?? r.term ?? "";

  const invoiceNo =
    r.invoice?.invoiceNo ||
    r.invoiceNo ||
    (r.invoice?.id ? String(r.invoice.id).slice(0, 8).toUpperCase() : "");

  const invoiceTotal = Number(r.invoice?.total ?? r.invoiceTotal ?? 0);
  const paid = Number(r.invoice?.paid ?? r.totalPaid ?? 0);
  const balance = Number(r.invoice?.balance ?? r.balance ?? 0);

  const receivedBy =
    r.receivedByName ||
    r.payment?.receivedByName ||
    r.payment?.receivedByUser?.name ||
    r.payment?.receivedByUser?.email ||
    "Cashier";

  const narrative =
    r.narrative ||
    r.payment?.narrative ||
    r.paymentFor ||
    r.reason ||
    "School Fees";

  return {
    studentName,
    admissionNo,
    className,
    receiptNo,
    createdAt,
    amount,
    method,
    reference,
    year,
    term,
    invoiceNo,
    invoiceTotal,
    paid,
    balance,
    receivedBy,
    narrative,
  };
}

export default function ReceiptPrint({ receipt }) {
  // IMPORTANT: keep print target mounted to avoid print-race blank pages
  const r = receipt ? normalizeReceipt(receipt) : null;

  return (
    <PrintDocument id="print-fees-receipt">
      {!r ? null : <A4Receipt r={r} />}
    </PrintDocument>
  );
}

function A4Receipt({ r }) {
  return (
    <div className="fees-a4">
      {/* Title-only header (school identity comes from PrintLetterhead) */}
      <div className="fees-a4__header">
        <div />
        <div className="fees-a4__titleBox">
          <div className="fees-a4__title">FEES PAYMENT RECEIPT</div>
          <div className="fees-a4__titleSub">
            Receipt No: <b>{r.receiptNo}</b>
          </div>
          <div className="fees-a4__titleSub">Date: {fmtDate(r.createdAt)}</div>
        </div>
      </div>

      <div className="fees-a4__rule" />

      <div className="fees-a4__grid">
        <div className="fees-a4__box">
          <div className="fees-a4__boxTitle">Student Details</div>

          <div className="fees-a4__row">
            <span>Student</span>
            <b>{r.studentName}</b>
          </div>

          <div className="fees-a4__row">
            <span>Admission No</span>
            <b>{r.admissionNo}</b>
          </div>

          <div className="fees-a4__row">
            <span>Class</span>
            <b>{r.className}</b>
          </div>

          <div className="fees-a4__row">
            <span>Term / Year</span>
            <b>
              {r.term || "—"} {r.year ? `• ${r.year}` : ""}
            </b>
          </div>
        </div>

        <div className="fees-a4__box">
          <div className="fees-a4__boxTitle">Payment Details</div>

          <div className="fees-a4__row">
            <span>Payment Method</span>
            <b>{r.method}</b>
          </div>

          <div className="fees-a4__row">
            <span>Reference</span>
            <b>{r.reference || "—"}</b>
          </div>

          <div className="fees-a4__row">
            <span>Invoice No</span>
            <b>{r.invoiceNo || "—"}</b>
          </div>

          <div className="fees-a4__row">
            <span>Paid For</span>
            <b>{r.narrative}</b>
          </div>
        </div>
      </div>

      <div className="fees-a4__amount">
        <div className="fees-a4__amountLabel">AMOUNT PAID</div>
        <div className="fees-a4__amountValue">KSh {money(r.amount)}</div>
      </div>

      <div className="fees-a4__totals">
        <div className="fees-a4__totalsRow">
          <span>Invoice Total</span>
          <b>KSh {money(r.invoiceTotal)}</b>
        </div>

        <div className="fees-a4__totalsRow">
          <span>Total Paid</span>
          <b>KSh {money(r.paid)}</b>
        </div>

        <div className="fees-a4__totalsRow fees-a4__totalsRow--strong">
          <span>Balance</span>
          <b>KSh {money(r.balance)}</b>
        </div>
      </div>

      <div className="fees-a4__footer">
        <div className="fees-a4__sig">
          <div className="fees-a4__sigLine" />
          <div className="fees-a4__sigLabel">Received By: {r.receivedBy}</div>
        </div>

        <div className="fees-a4__sig">
          <div className="fees-a4__sigLine" />
          <div className="fees-a4__sigLabel">Signature & Stamp</div>
        </div>
      </div>

      <div className="fees-a4__note">
        This is a computer-generated receipt. Keep it for records.
      </div>
    </div>
  );
}
