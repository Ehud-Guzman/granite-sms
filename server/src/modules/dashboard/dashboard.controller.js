import * as svc from "./dashboard.service.js";

export async function getSummary(req, res) {
  try {
    const data = await svc.getSummary(req);
    return res.json({ data });
  } catch (err) {
    console.error("DASHBOARD SUMMARY ERROR:", err);
    return res.status(err.statusCode || 400).json({ message: err.message || "Server error" });
  }
}

export async function getActivity(req, res) {
  try {
    const data = await svc.getActivity(req);
    return res.json({ data });
  } catch (err) {
    console.error("DASHBOARD ACTIVITY ERROR:", err);
    return res.status(err.statusCode || 400).json({ message: err.message || "Server error" });
  }
}
