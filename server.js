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
    res.end("Not found");
    return;
  }

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.error("File error:", err);
      res.writeHead(500);
      res.end("Server error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server
});

let cameraSocket = null;
let cameraId = null;

const viewers = new Map();

wss.on("connection", (ws, req) => {
  const pathname = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  console.log("WebSocket connection:", pathname);

  // =========================
  // CAMERA
  // =========================

  if (pathname === "/camera") {
    const newCameraId = makeId();

    cameraSocket = ws;
    cameraId = newCameraId;

    send(ws, {
      type: "role",
      role: "camera",
      cameraId: newCameraId
    });

    console.log(
      "Camera connected:",
      newCameraId
    );

    for (const viewer of viewers.values()) {
      send(viewer.ws, {
        type: "camera-online",
        cameraId: newCameraId
      });
    }

    ws.on("message", raw => {
      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch (error) {
        console.error("Invalid camera message");
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
            cameraId: newCameraId,
            facingMode:
              msg.facingMode || "user"
          });
        }

        return;
      }

      // Forward camera WebRTC messages
      // to the correct viewer
      if (msg.toViewerId) {
        const viewer =
          viewers.get(msg.toViewerId);

        if (viewer) {
          send(viewer.ws, {
            ...msg,
            cameraId: newCameraId
          });
        }
      }
    });

    ws.on("close", () => {
      console.log(
        "Camera disconnected:",
        newCameraId
      );

      if (cameraSocket === ws) {
        cameraSocket = null;
        cameraId = null;

        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-offline",
            cameraId: newCameraId
          });
        }
      }
    });

    return;
  }

  // =========================
  // VIEWER
  // =========================

  if (pathname === "/viewer") {
    const viewerId = makeId();

    const viewer = {
      ws: ws,
      viewerId: viewerId
    };

    viewers.set(viewerId, viewer);

    console.log(
      "Viewer connected:",
      viewerId
    );

    send(ws, {
      type: "role",
      role: "viewer",
      viewerId: viewerId,
      cameras:
        cameraSocket && cameraId
          ? [cameraId]
          : []
    });

    if (cameraSocket && cameraId) {
      send(ws, {
        type: "camera-online",
        cameraId: cameraId
      });
    }

    ws.on("message", raw => {
      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch (error) {
        console.error("Invalid viewer message");
        return;
      }

      if (!cameraSocket || !cameraId) {
        return;
      }

      // Viewer is ready for WebRTC
      if (msg.type === "viewer-ready") {
        send(cameraSocket, {
          type: "viewer-ready",
          viewerId: viewerId,
          cameraId: cameraId
        });

        return;
      }

      // Viewer wants front/back camera
      if (msg.type === "switch-camera") {
        if (
          msg.facingMode !== "user" &&
          msg.facingMode !== "environment"
        ) {
          return;
        }

        console.log(
          "Camera switch request:",
          msg.facingMode
        );

        send(cameraSocket, {
          type: "switch-camera",
          facingMode: msg.facingMode,
          viewerId: viewerId
        });

        return;
      }

      // WebRTC answer
      if (msg.type === "answer") {
        send(cameraSocket, {
          type: "answer",
          answer: msg.answer,
          viewerId: viewerId
        });

        return;
      }

      // WebRTC ICE candidate
      if (msg.type === "candidate") {
        send(cameraSocket, {
          type: "candidate",
          candidate: msg.candidate,
          viewerId: viewerId
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

      if (cameraSocket) {
        send(cameraSocket, {
          type: "viewer-left",
          viewerId: viewerId
        });
      }
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
