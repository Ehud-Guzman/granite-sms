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
