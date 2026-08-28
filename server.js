const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let file;

  if (req.url === "/" || req.url === "/camera.html") {
    file = "camera.html";
  } else if (req.url === "/viewer.html") {
    file = "viewer.html";
  } else {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const filePath = path.join(__dirname, file);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      res.end("Server error");
      return;
    }

    const type = file.endsWith(".html")
      ? "text/html; charset=utf-8"
      : "text/plain";

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

let camera = null;
let viewer = null;

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "register") {
      if (message.role === "camera") {
        camera = ws;

        send(ws, {
          type: "registered",
          role: "camera"
        });

        if (viewer) {
          send(viewer, {
            type: "camera-online"
          });
        }

        return;
      }

      if (message.role === "viewer") {
        viewer = ws;

        send(ws, {
          type: "registered",
          role: "viewer",
          cameraOnline: !!camera
        });

        if (camera) {
          send(camera, {
            type: "viewer-online"
          });
        }

        return;
      }
    }

    // Forward WebRTC signaling messages.
    if (message.type === "offer" ||
        message.type === "answer" ||
        message.type === "candidate") {

      if (ws === camera) {
        send(viewer, message);
      } else if (ws === viewer) {
        send(camera, message);
      }

      return;
    }
  });

  ws.on("close", () => {
    if (ws === camera) {
      camera = null;

      send(viewer, {
        type: "camera-offline"
      });
    }

    if (ws === viewer) {
      viewer = null;

      send(camera, {
        type: "viewer-offline"
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
