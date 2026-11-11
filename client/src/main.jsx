import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import App from "./App.jsx";
import AuthEventBridge from "./components/AuthEventBridge.jsx";
import DemoBanner from "./components/demo/DemoBanner.jsx";
import { ConfirmDialogProvider } from "./components/ui/confirm-dialog.jsx";
import { IS_DEMO } from "./lib/demo";
import "./index.css";

// The demo is sample data: keep it out of search results, and name the tab after the sample school.
if (IS_DEMO) {
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.appendChild(robots);
  document.title = "Mwangaza Academy · Granite SMS demo";
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30 * 1000,
    },
  },
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthEventBridge />
        <DemoBanner />
        <App />
        <Toaster richColors position="top-right" />
        <ConfirmDialogProvider />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
