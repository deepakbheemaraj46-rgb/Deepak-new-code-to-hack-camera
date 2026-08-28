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
    "/": "camera.html",
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

  if (pathname === "/camera") {

    const cameraId = makeId();

    const camera = {
      ws,
      live: false,
      currentCamera: "front"
    };

    cameras.set(cameraId, camera);

    send(ws, {
      type: "role",
      role: "camera",
      cameraId
    });

    for (const [viewerId, viewer] of viewers) {

      send(viewer.ws, {
        type: "camera-online",
        cameraId
      });

      if (camera.live) {
        send(viewer.ws, {
          type: "camera-live",
          cameraId,
          currentCamera: camera.currentCamera
        });
      }
    }

    ws.on("message", raw => {

      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "camera-live") {

        camera.live = true;
        camera.currentCamera =
          msg.currentCamera || "front";

        for (const [viewerId, viewer] of viewers) {

          send(viewer.ws, {
            type: "camera-live",
            cameraId,
            currentCamera:
              camera.currentCamera
          });

          send(ws, {
            type: "viewer-ready",
            viewerId
          });
        }

        return;
      }

      if (msg.type === "camera-switched") {

        camera.currentCamera =
          msg.currentCamera || "front";

        for (const viewer of viewers.values()) {
          send(viewer.ws, {
            type: "camera-switched",
            cameraId,
            currentCamera:
              camera.currentCamera
          });
        }

        return;
      }

      if (msg.toViewerId) {

        const viewer =
          viewers.get(msg.toViewerId);

        if (viewer) {
          send(viewer.ws, {
            ...msg,
            cameraId
          });
        }
      }
    });

    ws.on("close", () => {

      if (cameras.get(cameraId)?.ws !== ws) {
        return;
      }

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

    for (const [cameraId, camera] of cameras) {

      send(ws, {
        type: "camera-online",
        cameraId
      });

      if (camera.live) {

        send(ws, {
          type: "camera-live",
          cameraId,
          currentCamera:
            camera.currentCamera
        });

        send(camera.ws, {
          type: "viewer-ready",
          viewerId
        });
      }
    }

    ws.on("message", raw => {

      let msg;

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (
        msg.type === "viewer-ready" &&
        msg.cameraId
      ) {

        const camera =
          cameras.get(msg.cameraId);

        if (camera) {
          send(camera.ws, {
            type: "viewer-ready",
            viewerId
          });
        }

        return;
      }

      /*
        VIEWER REQUESTS PHYSICAL
        CAMERA SWITCH
      */

      if (
        msg.type === "switch-camera" &&
        msg.cameraId &&
        (
          msg.camera === "front" ||
          msg.camera === "back"
        )
      ) {

        const camera =
          cameras.get(msg.cameraId);

        if (camera) {

          send(camera.ws, {
            type: "switch-camera",
            camera: msg.camera,
            viewerId
          });

        }

        return;
      }

      if (msg.cameraId) {

        const camera =
          cameras.get(msg.cameraId);

        if (camera) {

          send(camera.ws, {
            ...msg,
            toViewerId: viewerId
          });

        }
      }
    });

    ws.on("close", () => {

      viewers.delete(viewerId);

      for (const camera of cameras.values()) {

        send(camera.ws, {
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
  console.log(
    `Server running on port ${PORT}`
  );
});
