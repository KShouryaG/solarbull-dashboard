import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import App from "./App.jsx";

// Note: StrictMode removed — react-leaflet throws "Map container already initialized"
// when StrictMode double-mounts components in development (React 18 known issue).
ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
