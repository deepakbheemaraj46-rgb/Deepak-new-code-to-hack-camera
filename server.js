"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  let fileName;

  if (req.url === "/") {
    fileName = "camera.html";
  } else if (req.url === "/viewer") {
    fileName = "viewer.html";
  } else {
    res.writeHead(404);
    return res.end("Not found");
  }

  const filePath = path.join(__dirname, fileName);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("File error");
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

/*
  cameras:
  cameraId -> {
    ws,
    peers: Map(viewerId -> RTCPeerConnection on camera side)
  }
*/
const cameras = new Map();

/*
  viewers:
  viewerId -> websocket
*/
const viewers = new Map();

function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendToViewer(viewerId, message) {
  send(viewers.get(viewerId), message);
}

function sendToCamera(cameraId, message) {
  const camera = cameras.get(cameraId);
  if (camera) {
    send(camera.ws, message);
  }
}

wss.on("connection", ws => {
  const connectionId = crypto.randomUUID();

  let role = null;
  let id = null;

  ws.on("message", raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    /*
      CAMERA REGISTRATION
    */
    if (msg.type === "register-camera") {
      role = "camera";
      id = msg.cameraId || connectionId;

      cameras.set(id, {
        ws,
        peers: new Map()
      });

      // Tell every currently connected viewer.
      for (const viewerId of viewers.keys()) {
        sendToViewer(viewerId, {
          type: "camera-online",
          cameraId: id
        });
      }

      console.log("Camera connected:", id);
      return;
    }

    /*
      VIEWER REGISTRATION
    */
    if (msg.type === "register-viewer") {
      role = "viewer";
      id = msg.viewerId || connectionId;

      viewers.set(id, ws);

      // Send all currently online cameras.
      for (const cameraId of cameras.keys()) {
        send(ws, {
          type: "camera-online",
          cameraId
        });
      }

      console.log("Viewer connected:", id);
      return;
    }

    /*
      VIEWER WANTS A CAMERA
    */
    if (msg.type === "watch-camera") {
      if (role !== "viewer") return;

      const camera = cameras.get(msg.cameraId);

      if (!camera) {
        send(ws, {
          type: "camera-error",
          cameraId: msg.cameraId,
          message: "Camera is offline"
        });
        return;
      }

      sendToCamera(msg.cameraId, {
        type: "viewer-request",
        cameraId: msg.cameraId,
        viewerId: id
      });

      return;
    }

    /*
      CAMERA -> VIEWER
      OFFER
    */
    if (msg.type === "offer") {
      sendToViewer(msg.viewerId, {
        type: "offer",
        cameraId: msg.cameraId,
        viewerId: msg.viewerId,
        sdp: msg.sdp
      });

      return;
    }

    /*
      VIEWER -> CAMERA
      ANSWER
    */
    if (msg.type === "answer") {
      sendToCamera(msg.cameraId, {
        type: "answer",
        viewerId: msg.viewerId,
        sdp: msg.sdp
      });

      return;
    }

    /*
      CAMERA -> VIEWER
      ICE
    */
    if (msg.type === "camera-ice") {
      sendToViewer(msg.viewerId, {
        type: "camera-ice",
        cameraId: msg.cameraId,
        viewerId: msg.viewerId,
        candidate: msg.candidate
      });

      return;
    }

    /*
      VIEWER -> CAMERA
      ICE
    */
    if (msg.type === "viewer-ice") {
      sendToCamera(msg.cameraId, {
        type: "viewer-ice",
        viewerId: msg.viewerId,
        candidate: msg.candidate
      });

      return;
    }
  });

  ws.on("close", () => {
    if (role === "camera" && id) {
      cameras.delete(id);

      for (const viewerId of viewers.keys()) {
        sendToViewer(viewerId, {
          type: "camera-offline",
          cameraId: id
        });
      }

      console.log("Camera disconnected:", id);
    }

    if (role === "viewer" && id) {
      viewers.delete(id);

      // Tell cameras this viewer has gone.
      for (const cameraId of cameras.keys()) {
        sendToCamera(cameraId, {
          type: "viewer-left",
          viewerId: id
        });
      }

      console.log("Viewer disconnected:", id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
