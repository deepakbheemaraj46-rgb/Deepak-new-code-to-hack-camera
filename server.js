const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function makeId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4)
  );
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
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

let cameraSocket = null;
let cameraId = null;

const viewers = new Map();

wss.on("connection", (ws, req) => {
  const pathname = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  /*
   * CAMERA
   */
  if (pathname === "/camera") {
    cameraId = makeId();
    cameraSocket = ws;

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

      /*
       * Camera tells viewers that both streams
       * are available.
       */
      if (msg.type === "camera-live") {
        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-live",
            cameraId
          });
        }

        return;
      }

      /*
       * Forward WebRTC messages from camera
       * to the correct viewer.
       */
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
      if (cameraSocket === ws) {
        cameraSocket = null;

        const oldCameraId = cameraId;
        cameraId = null;

        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-offline",
            cameraId: oldCameraId
          });
        }
      }
    });

    return;
  }

  /*
   * VIEWER
   */
  if (pathname === "/viewer") {
    const viewerId = makeId();

    const viewer = {
      ws,
      viewerId
    };

    viewers.set(viewerId, viewer);

    send(ws, {
      type: "role",
      role: "viewer",
      viewerId,
      cameras: cameraSocket && cameraId
        ? [cameraId]
        : []
    });

    if (cameraSocket && cameraId) {
      send(ws, {
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

      if (!cameraSocket || !cameraId) {
        return;
      }

      /*
       * Viewer requests WebRTC connection.
       */
      if (msg.type === "viewer-ready") {
        send(cameraSocket, {
          ...msg,
          viewerId,
          cameraId
        });

        return;
      }

      /*
       * Forward WebRTC signaling to camera.
       */
      if (
        msg.type === "answer" ||
        msg.type === "candidate"
      ) {
        send(cameraSocket, {
          ...msg,
          viewerId,
          cameraId
        });
      }
    });

    ws.on("close", () => {
      viewers.delete(viewerId);

      /*
       * Tell camera that this viewer disconnected.
       */
      if (cameraSocket) {
        send(cameraSocket, {
          type: "viewer-left",
          viewerId
        });
      }
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Multi-camera server running on port ${PORT}`
  );
});
