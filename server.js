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

const routes = {
  "/": "camera.html",
  "/camera": "camera.html",
  "/camera.html": "camera.html",
  "/viewer": "viewer.html",
  "/viewer.html": "viewer.html"
};

const server = http.createServer((req, res) => {
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

const wss = new WebSocket.Server({
  server,
  perMessageDeflate: false
});

const cameras = new Map();
const viewers = new Map();

wss.on("connection", (ws, req) => {
  const pathname = new URL(
    req.url,
    "http://localhost"
  ).pathname;

  if (pathname !== "/camera" && pathname !== "/viewer") {
    ws.close();
    return;
  }

  /* =========================
     CAMERA
  ========================= */

  if (pathname === "/camera") {

    const cameraId = makeId();

    cameras.set(cameraId, ws);

    ws.cameraId = cameraId;
    ws.cameraLive = false;

    send(ws, {
      type: "role",
      role: "camera",
      cameraId
    });

    console.log("Camera connected:", cameraId);

    /* Tell existing viewers */

    for (const viewer of viewers.values()) {
      send(viewer, {
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

      console.log(
        "CAMERA MESSAGE:",
        cameraId,
        msg.type
      );

      /* Camera became live */

      if (msg.type === "camera-live") {

        ws.cameraLive = true;

        for (const [viewerId, viewer] of viewers.entries()) {

          send(viewer, {
            type: "camera-live",
            cameraId
          });

          send(ws, {
            type: "viewer-ready",
            viewerId
          });
        }

        return;
      }

      /* Camera -> viewer */

      if (msg.toViewerId) {

        const viewer =
          viewers.get(msg.toViewerId);

        if (!viewer) return;

        send(viewer, {
          ...msg,
          cameraId
        });

        return;
      }
    });

    ws.on("close", () => {

      if (cameras.get(cameraId) === ws) {

        cameras.delete(cameraId);

        console.log(
          "Camera disconnected:",
          cameraId
        );

        for (const viewer of viewers.values()) {

          send(viewer, {
            type: "camera-offline",
            cameraId
          });

        }
      }
    });

    ws.on("error", () => {});

    return;
  }


  /* =========================
     VIEWER
  ========================= */

  const viewerId = makeId();

  viewers.set(viewerId, ws);

  ws.viewerId = viewerId;

  console.log(
    "Viewer connected:",
    viewerId
  );


  /* Send current cameras */

  send(ws, {
    type: "role",
    role: "viewer",
    viewerId,
    cameras: [...cameras.keys()]
  });


  /* Tell viewer about cameras */

  for (const [cameraId, camera] of cameras.entries()) {

    send(ws, {
      type: "camera-online",
      cameraId
    });

    if (camera.cameraLive) {

      send(ws, {
        type: "camera-live",
        cameraId
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

    console.log(
      "VIEWER MESSAGE:",
      viewerId,
      msg.type
    );


    /* =========================
       VIEWER REQUESTS OFFER
    ========================= */

    if (
      msg.type === "viewer-ready" &&
      msg.cameraId
    ) {

      const camera =
        cameras.get(msg.cameraId);

      if (!camera) return;

      send(camera, {
        type: "viewer-ready",
        viewerId
      });

      return;
    }


    /* =========================
       VIEWER -> CAMERA
       ANSWER / ICE
    ========================= */

    if (msg.cameraId) {

      const camera =
        cameras.get(msg.cameraId);

      if (!camera) return;

      send(camera, {
        ...msg,
        toViewerId: viewerId
      });

      return;
    }
  });


  ws.on("close", () => {

    viewers.delete(viewerId);

    console.log(
      "Viewer disconnected:",
      viewerId
    );

  });

  ws.on("error", () => {});
});


server.listen(PORT, "0.0.0.0", () => {

  console.log(
    `Remote camera server running on port ${PORT}`
  );

});
