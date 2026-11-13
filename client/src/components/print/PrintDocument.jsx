import PrintLetterhead from "./PrintLetterhead";
import PrintFooter from "./PrintFooter";

// `screen`: also show the content on screen (letterhead and footer stay
// print-only). Reports use it because this block is their only view; without
// it a loaded report was invisible. Receipts and result slips leave it off:
// they draw a separate screen version.
// `bodyClassName` styles the content itself (e.g. spacing between cards).
export default function PrintDocument({ id, children, className = "", bodyClassName = "", screen = false }) {
  return (
    <div id={id} className={`print-only ${screen ? "print-screen" : ""} ${className}`}>
      <div className="print-doc">
        <PrintLetterhead />

        {/* makes the page stretch so footer/signatures can stick down */}
        <div className={`print-body ${bodyClassName}`}>{children}</div>

        <PrintFooter />
      </div>
    </div>
  );
}
