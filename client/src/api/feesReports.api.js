import { api } from "./axios";

export async function getFeesClassSummary(params) {
  const { data } = await api.get("/api/fees/reports/class-summary", { params });
  return data;
}

export async function getFeesDefaulters(params) {
  const { data } = await api.get("/api/fees/reports/defaulters", { params });
  return data;
}

export async function getFeesCollections(params) {
  const { data } = await api.get("/api/fees/reports/collections", { params });
  return data;
}
