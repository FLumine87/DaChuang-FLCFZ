import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./mockup.css";
import HomePage from "./HomePage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HomePage />
  </StrictMode>
);
