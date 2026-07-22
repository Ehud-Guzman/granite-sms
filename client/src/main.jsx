import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import App from "./App.jsx";
import AuthEventBridge from "./components/AuthEventBridge.jsx";
import { ConfirmDialogProvider } from "./components/ui/confirm-dialog.jsx";
import "./index.css";

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
        <App />
        <Toaster richColors position="top-right" />
        <ConfirmDialogProvider />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
