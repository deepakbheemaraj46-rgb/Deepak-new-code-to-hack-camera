const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

let camera = null;
const viewers = new Map();

function makeId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-6)
  );
}

function send(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error("Send error:", err.message);
  }
}

const routes = {
  "/": "index.html",
  "/camera": "camera.html",
  "/camera.html": "camera.html",
  "/viewer": "viewer.html",
  "/viewer.html": "viewer.html"
};

const server = http.createServer((req, res) => {
  let pathname;

  try {
    pathname = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`
    ).pathname;
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  const filename = routes[pathname];

  if (!filename) {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(
    path.join(__dirname, filename),
    (err, data) => {
      if (err) {
        console.error(err);
        res.writeHead(500);
        return res.end("Server error");
      }

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });

      res.end(data);
    }
  );
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  let pathname;

  try {
    pathname = new URL(
      req.url,
      "http://localhost"
    ).pathname;
  } catch {
    ws.close();
    return;
  }

  // =====================================================
  // CAMERA CONNECTION
  // =====================================================

  if (pathname === "/camera") {
    const cameraId = makeId();

    if (camera && camera.ws !== ws) {
      try {
        camera.ws.close();
      } catch {}
    }

    camera = {
      ws,
      id: cameraId
    };

    console.log("Camera connected:", cameraId);

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

      // Camera is live
      if (msg.type === "camera-live") {
        console.log(
          "Camera live:",
          msg.facingMode
        );

        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-live",
            cameraId,
            facingMode: msg.facingMode
          });
        }

        return;
      }

      // Camera -> viewer
      if (msg.toViewerId) {
        const viewer =
          viewers.get(msg.toViewerId);

        if (!viewer) return;

        send(viewer.ws, {
          ...msg,
          cameraId
        });
      }
    });

    ws.on("close", () => {
      if (!camera || camera.ws !== ws) return;

      console.log(
        "Camera disconnected:",
        cameraId
      );

      camera = null;

      for (const viewer of viewers.values()) {
        send(viewer.ws, {
          type: "camera-offline",
          cameraId
        });
      }
    });

    ws.on("error", err => {
      console.error(
        "Camera WebSocket error:",
        err.message
      );
    });

    return;
  }

  // =====================================================
  // VIEWER CONNECTION
  // =====================================================

  if (pathname === "/viewer") {
    const viewerId = makeId();

    const viewer = {
      ws,
      id: viewerId
    };

    viewers.set(viewerId, viewer);

    console.log(
      "Viewer connected:",
      viewerId
    );

    send(ws, {
      type: "role",
      role: "viewer",
      viewerId,
      cameraId: camera ? camera.id : null
    });

    if (camera) {
      send(ws, {
        type: "camera-online",
        cameraId: camera.id
      });
    }

    ws.on("message", raw => {
      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (!camera) {
        send(ws, {
          type: "camera-offline"
        });

        return;
      }

      // Viewer is ready for WebRTC
      if (msg.type === "viewer-ready") {
        send(camera.ws, {
          type: "viewer-ready",
          viewerId
        });

        return;
      }

      // Request front/back switch
      if (msg.type === "switch-camera") {
        if (
          msg.facingMode !== "user" &&
          msg.facingMode !== "environment"
        ) {
          return;
        }

        send(camera.ws, {
          type: "switch-camera",
          facingMode: msg.facingMode,
          viewerId
        });

        return;
      }

      // Answer
      if (msg.type === "answer") {
        send(camera.ws, {
          type: "answer",
          answer: msg.answer,
          viewerId
        });

        return;
      }

      // ICE candidate
      if (msg.type === "candidate") {
        send(camera.ws, {
          type: "candidate",
          candidate: msg.candidate,
          viewerId
        });

        return;
      }
    });

    ws.on("close", () => {
      console.log(
        "Viewer disconnected:",
        viewerId
      );

      viewers.delete(viewerId);

      if (camera) {
        send(camera.ws, {
          type: "viewer-left",
          viewerId
        });
      }
    });

    ws.on("error", err => {
      console.error(
        "Viewer WebSocket error:",
        err.message
      );
    });

    return;
  }

  ws.close();
});

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);
