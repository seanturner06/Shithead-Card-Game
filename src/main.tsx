/**
 * @file React entry point. Mounts the app into `#root` and wires up routing.
 *
 * Routes:
 * - `/` → {@link Landing} (create / join screen)
 * - `/room/:code` → {@link Room} (lobby + game + voice)
 *
 * Uses `BrowserRouter` (HTML5 History API), so production needs an SPA
 * rewrite rule on the host (Render dashboard rewrite or `public/_redirects`)
 * so `/room/ABCD` doesn't 404 on a hard refresh.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Room from "./pages/Room";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/room/:code" element={<Room />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
