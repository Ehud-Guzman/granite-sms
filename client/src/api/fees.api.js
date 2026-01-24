import { api } from "./axios";

const asArray = (v) => (Array.isArray(v) ? v : []);

// --------------------
// Subscription
// --------------------
export async function getFeesSubscription() {
  const { data } = await api.get("/api/fees/subscription");
  return data;
}

// --------------------
// Fee Items
// --------------------
export async function listFeeItems() {
  const { data } = await api.get("/api/fees/items");
  return asArray(data);
}
export async function createFeeItem(payload) {
  const { data } = await api.post("/api/fees/items", payload);
  return data;
}
export async function updateFeeItem(id, payload) {
  const { data } = await api.patch(`/api/fees/items/${id}`, payload);
  return data;
}
export async function deactivateFeeItem(id) {
  const { data } = await api.delete(`/api/fees/items/${id}`);
  return data;
}

// --------------------
// Fee Plans
// --------------------
export async function listFeePlans(params = {}) {
  const { data } = await api.get("/api/fees/plans", { params });
  return asArray(data);
}
export async function createFeePlan(payload) {
  const { data } = await api.post("/api/fees/plans", payload);
  return data;
}

// --------------------
// Invoices
// --------------------
export async function listFeeInvoices(params = {}) {
  const { data } = await api.get("/api/fees/invoices", { params });
  return asArray(data);
}
export async function getFeeInvoice(id) {
  const { data } = await api.get(`/api/fees/invoices/${id}`);
  return data;
}
export async function generateInvoice(payload) {
  const { data } = await api.post("/api/fees/invoices/generate", payload);
  return data;
}

// --------------------
// Student summary / statement
// --------------------
export async function getStudentFeesSummary(studentId, params = {}) {
  const { data } = await api.get(`/api/fees/students/${studentId}/summary`, { params });
  return data;
}
export async function getStudentFeesStatement(studentId, params = {}) {
  const { data } = await api.get(`/api/fees/students/${studentId}/statement`, { params });
  return data;
}

// --------------------
// Payments + receipts
// --------------------
export async function createFeePayment(payload) {
  const { data } = await api.post("/api/fees/payments", payload);
  return data; // { payment, invoice }
}

export async function getPaymentReceiptJson(paymentId) {
  const { data } = await api.get(`/api/fees/payments/${paymentId}/receipt`);
  return data;
}

// OPEN PDF WITH AUTH (correct way)
export async function openReceiptPdf(paymentId) {
  const res = await api.get(`/api/fees/payments/${paymentId}/receipt.pdf`, {
    responseType: "blob",
  });

  const file = new Blob([res.data], { type: "application/pdf" });
  const url = URL.createObjectURL(file);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function reverseFeePayment(paymentId, payload) {
  const { data } = await api.post(`/api/fees/payments/${paymentId}/reverse`, payload);
  return data;
}

export async function voidFeeInvoice(invoiceId, payload) {
  const { data } = await api.post(`/api/fees/invoices/${invoiceId}/void`, payload);
  return data;
}

// --------------------
// Reports
// --------------------
export async function feesClassSummary(params) {
  const { data } = await api.get("/api/fees/reports/class-summary", { params });
  return data;
}
export async function feesDefaulters(params) {
  const { data } = await api.get("/api/fees/reports/defaulters", { params });
  return data;
}
export async function feesCollections(params) {
  const { data } = await api.get("/api/fees/reports/collections", { params });
  return data;
}
