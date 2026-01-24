import PrintLetterhead from "./PrintLetterhead";
import PrintFooter from "./PrintFooter";

export default function PrintDocument({ id, children, className = "" }) {
  return (
    <div id={id} className={`print-only ${className}`}>
      <div className="print-doc">
        <PrintLetterhead />

        {/* makes the page stretch so footer/signatures can stick down */}
        <div className="print-body">{children}</div>

        <PrintFooter />
      </div>
    </div>
  );
}
