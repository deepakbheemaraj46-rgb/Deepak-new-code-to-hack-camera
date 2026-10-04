"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let file = "camera.html";

  if (req.url === "/viewer") {
    file = "viewer.html";
  }

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("File not found");
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

const cameras = new Map();
const viewers = new Set();

wss.on("connection", ws => {
  let role = null;
  let cameraId = null;

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "register-camera") {
      role = "camera";
      cameraId = msg.cameraId || crypto.randomUUID();

      cameras.set(cameraId, ws);

      // Tell viewers that a camera is available.
      broadcastViewers({
        type: "camera-online",
        cameraId
      });

      return;
    }

    if (msg.type === "register-viewer") {
      role = "viewer";
      viewers.add(ws);

      // Send currently connected cameras.
      for (const id of cameras.keys()) {
        ws.send(JSON.stringify({
          type: "camera-online",
          cameraId: id
        }));
      }

      return;
    }

    if (msg.type === "signal") {
      const target = cameras.get(msg.cameraId);

      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({
          type: "signal",
          from: "viewer",
          data: msg.data
        }));
      }

      return;
    }

    if (msg.type === "camera-signal") {
      broadcastViewers({
        type: "camera-signal",
        cameraId,
        data: msg.data
      });
    }
  });

  ws.on("close", () => {
    viewers.delete(ws);

    if (role === "camera" && cameraId) {
      cameras.delete(cameraId);

      broadcastViewers({
        type: "camera-offline",
        cameraId
      });
    }
  });
});

function broadcastViewers(message) {
  const data = JSON.stringify(message);

  for (const viewer of viewers) {
    if (viewer.readyState === WebSocket.OPEN) {
      viewer.send(data);
    }
  }
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
