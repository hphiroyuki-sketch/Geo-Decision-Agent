import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import { DisplayModeProvider } from "./lib/displayMode";
import App from "./App";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DisplayModeProvider>
          <App />
        </DisplayModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
