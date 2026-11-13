// Downloads a file from the API with the user's sign-in (a plain link or
// window.open can't send the token).
import { api } from "@/api/axios";

export async function downloadFromApi(url, fallbackName, params) {
  const res = await api.get(url, { params, responseType: "blob" });
  const cd = res.headers?.["content-disposition"] || "";
  const name = /filename="?([^";]+)"?/i.exec(cd)?.[1] || fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/**
 * Prints a server PDF (result slip, report card) exactly as designed in
 * Settings > Branding: fetches it and opens the print dialog on it. Phones
 * can't print from a hidden frame, so there the PDF opens in a new tab,
 * where the browser's share/print menu takes over.
 */
export async function printFromApi(url, params) {
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  // Opened before the request so pop-up blockers see it as part of the tap.
  const tab = touch ? window.open("", "_blank") : null;
  let href;
  try {
    const res = await api.get(url, { params, responseType: "blob" });
    href = URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
  } catch (e) {
    tab?.close();
    throw e;
  }
  if (tab) {
    tab.location.href = href;
    setTimeout(() => URL.revokeObjectURL(href), 120_000);
    return;
  }
  const frame = document.createElement("iframe");
  frame.title = "Print";
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = href;
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(href, "_blank");
    }
    // Long enough for the print dialog to finish with it.
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(href);
    }, 120_000);
  };
  document.body.appendChild(frame);
}
