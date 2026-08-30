const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function telegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const data = new URLSearchParams({
    chat_id: TELEGRAM_CHAT_ID,
    text: message
  }).toString();

  const req = https.request({
    hostname: "api.telegram.org",
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(data)
    }
  });
  req.on("error", () => {});
  req.write(data);
  req.end();
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function makeId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

const routes = {
  "/": "camera.html",
  "/camera": "camera.html",
  "/camera.html": "camera.html",
  "/viewer": "viewer.html",
  "/viewer.html": "viewer.html"
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  const file = routes[pathname];

  if (!file) {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("Server error");
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const cameras = new Map(); // cameraId -> ws
const viewers = new Map(); // viewerId -> ws

// Send viewer-ready to a camera for one viewer, with a short retry
// in case the offer never arrives (this removes the "long delay
// before I see video" symptom when a message gets dropped).
function requestOfferWithRetry(cameraWs, viewerId, attempt = 0) {
  if (!cameraWs || cameraWs.readyState !== WebSocket.OPEN) return;
  send(cameraWs, { type: "viewer-ready", viewerId });

  if (attempt >= 3) return;
  cameraWs._pendingOffers = cameraWs._pendingOffers || new Map();
  const timer = setTimeout(() => {
    // Only retry if we never saw an offer go out for this viewer.
    if (cameraWs._pendingOffers.get(viewerId)) {
      requestOfferWithRetry(cameraWs, viewerId, attempt + 1);
    }
  }, 2000);
  cameraWs._pendingOffers.set(viewerId, true);
  cameraWs._pendingOfferTimers = cameraWs._pendingOfferTimers || new Map();
  cameraWs._pendingOfferTimers.set(viewerId, timer);
}

wss.on("connection", (ws, req) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname !== "/camera" && pathname !== "/viewer") {
    ws.close();
    return;
  }

  const role = pathname === "/camera" ? "camera" : "viewer";

  // =========================
  // CAMERA
  // =========================
  if (role === "camera") {
    const cameraId = makeId();
    cameras.set(cameraId, ws);
    ws.cameraLive = false;

    send(ws, { type: "role", role: "camera", cameraId });

    for (const viewer of viewers.values()) {
      send(viewer, { type: "camera-online", cameraId });
    }

    telegram(
      `📷 Your camera "${cameraId}" connected.\n` +
      `Waiting for camera permission on that device.`
    );

    ws.on("message", raw => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "camera-live") {
        const wasAlreadyLive = ws.cameraLive;
        ws.cameraLive = true;

        if (!wasAlreadyLive) {
          telegram(`🟢 Camera "${cameraId}" is now live.`);
        }

        for (const [viewerId, viewer] of viewers.entries()) {
          send(viewer, { type: "camera-live", cameraId });
          requestOfferWithRetry(ws, viewerId);
        }
        return;
      }

      // Camera confirms it sent an offer for this viewer — clear retry.
      if (msg.type === "offer" && msg.toViewerId) {
        if (ws._pendingOffers) ws._pendingOffers.delete(msg.toViewerId);
        if (ws._pendingOfferTimers && ws._pendingOfferTimers.has(msg.toViewerId)) {
          clearTimeout(ws._pendingOfferTimers.get(msg.toViewerId));
          ws._pendingOfferTimers.delete(msg.toViewerId);
        }
      }

      // Camera -> viewer (offer / ICE candidates)
      if (msg.toViewerId) {
        const viewer = viewers.get(msg.toViewerId);
        if (viewer) {
          send(viewer, { ...msg, cameraId });
        }
        return;
      }
    });

    ws.on("close", () => {
      if (cameras.get(cameraId) === ws) {
        cameras.delete(cameraId);
        for (const viewer of viewers.values()) {
          send(viewer, { type: "camera-offline", cameraId });
        }
        telegram(`🔴 Camera "${cameraId}" disconnected.`);
      }
    });

    ws.on("error", () => {});
    return;
  }

  // =========================
  // VIEWER
  // =========================
  const viewerId = makeId();
  viewers.set(viewerId, ws);

  send(ws, { type: "role", role: "viewer", viewerId, cameras: [...cameras.keys()] });

  for (const [cameraId, camera] of cameras.entries()) {
    send(ws, { type: "camera-online", cameraId });
    if (camera.cameraLive) {
      send(ws, { type: "camera-live", cameraId });
    }
  }

  ws.on("message", raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Viewer wants camera video (also used to request an ICE restart —
    // see "restart" flag, which fixes the "still black after reconnect" case)
    if (msg.type === "viewer-ready" && msg.cameraId) {
      const camera = cameras.get(msg.cameraId);
      if (camera) {
        requestOfferWithRetry(camera, viewerId);
      }
      return;
    }

    // Viewer -> camera (answer / ICE candidates)
    if (msg.cameraId) {
      const camera = cameras.get(msg.cameraId);
      if (camera) {
        send(camera, { ...msg, toViewerId: viewerId });
      }
      return;
    }
  });

  ws.on("close", () => {
    viewers.delete(viewerId);
  });

  ws.on("error", () => {});
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Multi-camera server running on port ${PORT}`);
});
