const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

function makeId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-6)
  );
}

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

const server = http.createServer((req, res) => {
  const routes = {
    "/": "index.html",
    "/camera": "camera.html",
    "/camera.html": "camera.html",
    "/viewer": "viewer.html",
    "/viewer.html": "viewer.html"
  };

  const pathname = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  ).pathname;

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

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const cameras = new Map();
const viewers = new Map();

wss.on("connection", (ws, req) => {
  const pathname = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  // CAMERA CONNECTION
  if (pathname === "/camera") {
    const cameraId = makeId();

    cameras.set(cameraId, ws);

    send(ws, {
      type: "role",
      role: "camera",
      cameraId
    });

    for (const viewer of viewers.values()) {
      send(viewer.ws, {
        type: "camera-online",
        cameraId
      });
    }

    ws.on("message", raw => {
      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "camera-live") {
        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-live",
            cameraId,
            cameras: msg.cameras || []
          });
        }

        return;
      }

      if (msg.toViewerId) {
        const viewer = viewers.get(msg.toViewerId);

        if (viewer) {
          send(viewer.ws, {
            ...msg,
            cameraId
          });
        }
      }
    });

    ws.on("close", () => {
      if (cameras.get(cameraId) !== ws) return;

      cameras.delete(cameraId);

      for (const viewer of viewers.values()) {
        send(viewer.ws, {
          type: "camera-offline",
          cameraId
        });
      }
    });

    return;
  }

  // VIEWER CONNECTION
  if (pathname === "/viewer") {
    const viewerId = makeId();

    viewers.set(viewerId, {
      id: viewerId,
      ws
    });

    send(ws, {
      type: "role",
      role: "viewer",
      viewerId,
      cameras: [...cameras.keys()]
    });

    ws.on("message", raw => {
      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "viewer-ready" && msg.cameraId) {
        const camera = cameras.get(msg.cameraId);

        if (camera) {
          send(camera, {
            type: "viewer-ready",
            viewerId
          });
        }

        return;
      }

      if (msg.cameraId) {
        const camera = cameras.get(msg.cameraId);

        if (camera) {
          send(camera, {
            ...msg,
            toViewerId: viewerId
          });
        }
      }
    });

    ws.on("close", () => {
      viewers.delete(viewerId);

      for (const camera of cameras.values()) {
        send(camera, {
          type: "viewer-left",
          viewerId
        });
      }
    });

    return;
  }

  ws.close();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
