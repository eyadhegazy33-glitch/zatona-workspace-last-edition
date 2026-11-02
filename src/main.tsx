import "./lib/configureZod";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import "./index.css";
import { AuthProvider } from "./hooks/useAuth";
import { BrandingProvider } from "./hooks/useBranding";
import { router } from "./routes";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrandingProvider>
        <RouterProvider router={router} />
      </BrandingProvider>
    </AuthProvider>
  </React.StrictMode>,
);
