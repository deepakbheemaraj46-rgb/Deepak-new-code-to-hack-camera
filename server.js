const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/camera", (req, res) => {
  res.sendFile(path.join(__dirname, "camera.html"));
});

app.get("/viewer", (req, res) => {
  res.sendFile(path.join(__dirname, "viewer.html"));
});

const cameras = new Map();

const PORT = process.env.PORT || 3000;

/*
  Set these as environment variables on your server:

  NTFY_TOPIC=your-private-random-topic
  NTFY_SERVER=https://ntfy.sh
*/

const NTFY_SERVER =
  process.env.NTFY_SERVER || "https://ntfy.sh";

const NTFY_TOPIC =
  process.env.NTFY_TOPIC || "";

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function send(ws, data) {
  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    ws.send(JSON.stringify(data));
  }
}

async function notifyNtfy(title, message, tags = "") {
  if (!NTFY_TOPIC) {
    console.log(
      "NTFY_TOPIC is not configured:",
      title,
      message
    );
    return;
  }

  try {
    await fetch(
      `${NTFY_SERVER}/${encodeURIComponent(NTFY_TOPIC)}`,
      {
        method: "POST",
        headers: {
          "Title": title,
          "Priority": "4",
          "Tags": tags
        },
        body: message
      }
    );
  } catch (error) {
    console.error(
      "ntfy notification failed:",
      error.message
    );
  }
}

function broadcastCameraList() {
  const list = [...cameras.keys()];

  for (const client of wss.clients) {
    if (client.role === "viewer") {
      send(client, {
        type: "camera-list",
        cameras: list
      });
    }
  }
}

async function cameraBecameLive(cameraId) {
  const camera = cameras.get(cameraId);

  if (!camera || camera.live) return;

  camera.live = true;

  send(camera.ws, {
    type: "live-confirmed",
    cameraId
  });

  await notifyNtfy(
    "Camera is LIVE",
    `Camera ${cameraId} is now LIVE.`,
    "camera,red_circle"
  );

  broadcastCameraList();
}

async function cameraWentOffline(cameraId) {
  const camera = cameras.get(cameraId);

  if (!camera || !camera.live) return;

  camera.live = false;

  await notifyNtfy(
    "Camera OFFLINE",
    `Camera ${cameraId} is now offline.`,
    "camera,black_circle"
  );

  broadcastCameraList();
}

wss.on("connection", (ws) => {
  ws.role = null;
  ws.cameraId = null;
  ws.viewerId = null;

  ws.on("message", async (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // CAMERA REGISTRATION
    if (msg.type === "register-camera") {
      let cameraId =
        typeof msg.cameraId === "string" &&
        msg.cameraId.trim()
          ? msg.cameraId.trim().slice(0, 80)
          : makeId();

      const oldCamera = cameras.get(cameraId);

      if (oldCamera) {
        send(oldCamera.ws, {
          type: "replaced",
          message: "This camera session was replaced."
        });

        try {
          oldCamera.ws.close();
        } catch {}
      }

      ws.role = "camera";
      ws.cameraId = cameraId;

      cameras.set(cameraId, {
        ws,
        live: false,
        viewers: new Set()
      });

      send(ws, {
        type: "camera-registered",
        cameraId
      });

      broadcastCameraList();
      return;
    }

    // VIEWER REGISTRATION
    if (msg.type === "register-viewer") {
      ws.role = "viewer";
      ws.viewerId = makeId();

      send(ws, {
        type: "viewer-registered",
        viewerId: ws.viewerId,
        cameras: [...cameras.keys()]
      });

      return;
    }

    // VIEWER WATCHES CAMERA
    if (msg.type === "watch") {
      if (ws.role !== "viewer") return;

      const camera = cameras.get(msg.cameraId);

      if (!camera) {
        send(ws, {
          type: "camera-offline",
          cameraId: msg.cameraId
        });
        return;
      }

      camera.viewers.add(ws);

      send(camera.ws, {
        type: "viewer-joined",
        cameraId: msg.cameraId,
        viewerId: ws.viewerId
      });

      return;
    }

    // VIEWER LEAVES CAMERA
    if (msg.type === "unwatch") {
      const camera = cameras.get(msg.cameraId);

      if (camera) {
        camera.viewers.delete(ws);

        if (camera.viewers.size === 0) {
          await cameraWentOffline(msg.cameraId);
        }
      }

      return;
    }

    // CAMERA CONFIRMS THAT STREAM IS ACTIVE
    if (msg.type === "stream-live") {
      if (ws.role === "camera" && ws.cameraId) {
        await cameraBecameLive(ws.cameraId);
      }

      return;
    }

    // WEBRTC OFFER
    if (msg.type === "offer") {
      const camera = cameras.get(msg.cameraId);

      if (!camera) return;

      send(camera.ws, {
        type: "offer",
        cameraId: msg.cameraId,
        viewerId: msg.viewerId,
        offer: msg.offer
      });

      return;
    }

    // WEBRTC ANSWER
    if (msg.type === "answer") {
      const camera = cameras.get(msg.cameraId);

      if (!camera) return;

      for (const client of wss.clients) {
        if (
          client.role === "viewer" &&
          client.viewerId === msg.viewerId
        ) {
          send(client, {
            type: "answer",
            cameraId: msg.cameraId,
            viewerId: msg.viewerId,
            answer: msg.answer
          });
        }
      }

      return;
    }

    // ICE CANDIDATE
    if (msg.type === "candidate") {
      const camera = cameras.get(msg.cameraId);

      if (!camera) return;

      if (ws.role === "viewer") {
        send(camera.ws, {
          type: "candidate",
          cameraId: msg.cameraId,
          viewerId: ws.viewerId,
          candidate: msg.candidate
        });
      } else if (ws.role === "camera") {
        for (const client of wss.clients) {
          if (
            client.role === "viewer" &&
            client.viewerId === msg.viewerId
          ) {
            send(client, {
              type: "candidate",
              cameraId: msg.cameraId,
              viewerId: msg.viewerId,
              candidate: msg.candidate
            });
          }
        }
      }

      return;
    }
  });

  ws.on("close", async () => {
    // CAMERA CLOSED
    if (ws.role === "camera" && ws.cameraId) {
      const camera = cameras.get(ws.cameraId);

      if (camera && camera.ws === ws) {
        const cameraId = ws.cameraId;
        cameras.delete(cameraId);

        await notifyNtfy(
          "Camera OFFLINE",
          `Camera ${cameraId} closed or disconnected.`,
          "camera,black_circle"
        );

        broadcastCameraList();
      }
    }

    // VIEWER CLOSED
    if (ws.role === "viewer") {
      for (const [cameraId, camera] of cameras) {
        camera.viewers.delete(ws);

        if (camera.viewers.size === 0) {
          await cameraWentOffline(cameraId);
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
