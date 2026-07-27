import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { TranslationProvider } from "./components/TranslationProvider.tsx";
import { installGlobalErrorReporting } from "./libs/utils/errorReporter.ts";

// 개별 try/catch로 잡히지 않은 예외까지 네이티브로 흘려보낸다
installGlobalErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TranslationProvider>
      <App />
    </TranslationProvider>
  </StrictMode>
);
