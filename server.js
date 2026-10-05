"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;


/* =========================================
   HTTP SERVER
========================================= */

const server = http.createServer((req, res) => {

  let fileName;

  if (req.url === "/") {

    fileName = "camera.html";

  } else if (req.url === "/viewer") {

    fileName = "viewer.html";

  } else {

    res.writeHead(404);
    return res.end("Not Found");

  }


  const filePath =
    path.join(__dirname, fileName);


  fs.readFile(
    filePath,
    (err, data) => {

      if (err) {

        console.error(
          "File error:",
          err
        );

        res.writeHead(500);
        return res.end("File Error");

      }


      res.writeHead(200, {

        "Content-Type":
          "text/html; charset=utf-8",

        "Cache-Control":
          "no-store, no-cache, must-revalidate"

      });


      res.end(data);

    }
  );

});


/* =========================================
   WEBSOCKET SERVER
========================================= */

const wss =
  new WebSocket.Server({
    server
  });


/* =========================================
   STORAGE
========================================= */

/*
  cameras:
  cameraId -> {
    ws
  }

  viewers:
  viewerId -> ws
*/

const cameras =
  new Map();

const viewers =
  new Map();


/* =========================================
   SEND HELPER
========================================= */

function send(ws, data) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return false;
  }


  try {

    ws.send(
      JSON.stringify(data)
    );

    return true;

  } catch (err) {

    console.error(
      "Send error:",
      err.message
    );

    return false;

  }

}


/* =========================================
   SEND TO CAMERA
========================================= */

function sendToCamera(
  cameraId,
  data
) {

  const camera =
    cameras.get(cameraId);


  if (!camera) {

    console.log(
      "Camera not found:",
      cameraId
    );

    return false;

  }


  return send(
    camera.ws,
    data
  );

}


/* =========================================
   SEND TO VIEWER
========================================= */

function sendToViewer(
  viewerId,
  data
) {

  const viewer =
    viewers.get(viewerId);


  if (!viewer) {

    console.log(
      "Viewer not found:",
      viewerId
    );

    return false;

  }


  return send(
    viewer,
    data
  );

}


/* =========================================
   SEND ONLINE CAMERAS
   TO ONE VIEWER
========================================= */

function sendOnlineCamerasToViewer(
  viewerId
) {

  const viewer =
    viewers.get(viewerId);


  if (!viewer) {
    return;
  }


  for (
    const cameraId
    of cameras.keys()
  ) {

    send(
      viewer,
      {

        type:
          "camera-online",

        cameraId:
          cameraId

      }
    );

  }

}


/* =========================================
   BROADCAST CAMERA ONLINE
========================================= */

function broadcastCameraOnline(
  cameraId
) {

  for (
    const viewerId
    of viewers.keys()
  ) {

    sendToViewer(
      viewerId,
      {

        type:
          "camera-online",

        cameraId:
          cameraId

      }
    );

  }

}


/* =========================================
   BROADCAST CAMERA OFFLINE
========================================= */

function broadcastCameraOffline(
  cameraId
) {

  for (
    const viewerId
    of viewers.keys()
  ) {

    sendToViewer(
      viewerId,
      {

        type:
          "camera-offline",

        cameraId:
          cameraId

      }
    );

  }

}


/* =========================================
   WEBSOCKET CONNECTION
========================================= */

wss.on(
  "connection",
  ws => {

    let role = null;

    let id =
      crypto.randomUUID();


    console.log(
      "WebSocket connected"
    );


    /* =====================================
       MESSAGE
    ===================================== */

    ws.on(
      "message",
      raw => {

        let msg;


        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch (err) {

          console.error(
            "Invalid JSON received"
          );

          return;

        }


        if (
          !msg ||
          typeof msg.type !== "string"
        ) {

          console.log(
            "Invalid message"
          );

          return;

        }


        console.log(
          "MESSAGE:",
          msg.type
        );


        /* =================================
           REGISTER CAMERA
        ================================= */

        if (
          msg.type ===
          "register-camera"
        ) {

          if (!msg.cameraId) {

            console.log(
              "Camera ID missing"
            );

            return;

          }


          role =
            "camera";

          id =
            msg.cameraId;


          /*
            If the same camera reconnects,
            replace its old socket.
          */

          const oldCamera =
            cameras.get(id);


          if (
            oldCamera &&
            oldCamera.ws !== ws
          ) {

            try {

              oldCamera.ws.close();

            } catch {}

          }


          cameras.set(
            id,
            {
              ws: ws
            }
          );


          console.log(
            "CAMERA ONLINE:",
            id
          );


          /*
            Tell all viewers that the
            camera is online.
          */

          broadcastCameraOnline(
            id
          );


          return;

        }


        /* =================================
           REGISTER VIEWER
        ================================= */

        if (
          msg.type ===
          "register-viewer"
        ) {

          if (!msg.viewerId) {

            console.log(
              "Viewer ID missing"
            );

            return;

          }


          role =
            "viewer";

          id =
            msg.viewerId;


          /*
            If viewer reconnects,
            replace old socket.
          */

          const oldViewer =
            viewers.get(id);


          if (
            oldViewer &&
            oldViewer !== ws
          ) {

            try {

              oldViewer.close();

            } catch {}

          }


          viewers.set(
            id,
            ws
          );


          console.log(
            "VIEWER ONLINE:",
            id
          );


          /*
            Send all currently
            online cameras.
          */

          sendOnlineCamerasToViewer(
            id
          );


          return;

        }


        /* =================================
           WATCH CAMERA
        ================================= */

        if (
          msg.type ===
          "watch-camera"
        ) {

          if (!msg.cameraId) {

            console.log(
              "Camera ID missing"
            );

            return;

          }


          console.log(
            "WATCH CAMERA:",
            msg.cameraId,
            "BY VIEWER:",
            id
          );


          sendToCamera(
            msg.cameraId,
            {

              type:
                "viewer-request",

              viewerId:
                id,

              cameraId:
                msg.cameraId

            }
          );


          return;

        }


        /* =================================
           CAMERA OFFER
           CAMERA → VIEWER
        ================================= */

        if (
          msg.type ===
          "offer"
        ) {

          console.log(
            "OFFER:",
            msg.cameraId,
            "→",
            msg.viewerId
          );


          sendToViewer(
            msg.viewerId,
            {

              type:
                "offer",

              cameraId:
                msg.cameraId,

              viewerId:
                msg.viewerId,

              sdp:
                msg.sdp

            }
          );


          return;

        }


        /* =================================
           VIEWER ANSWER
           VIEWER → CAMERA
        ================================= */

        if (
          msg.type ===
          "answer"
        ) {

          console.log(
            "ANSWER:",
            msg.viewerId,
            "→",
            msg.cameraId
          );


          sendToCamera(
            msg.cameraId,
            {

              type:
                "answer",

              cameraId:
                msg.cameraId,

              viewerId:
                msg.viewerId,

              sdp:
                msg.sdp

            }
          );


          return;

        }


        /* =================================
           CAMERA ICE
           CAMERA → VIEWER
        ================================= */

        if (
          msg.type ===
          "camera-ice"
        ) {

          sendToViewer(
            msg.viewerId,
            {

              type:
                "camera-ice",

              cameraId:
                msg.cameraId,

              viewerId:
                msg.viewerId,

              candidate:
                msg.candidate

            }
          );


          return;

        }


        /* =================================
           VIEWER ICE
           VIEWER → CAMERA
        ================================= */

        if (
          msg.type ===
          "viewer-ice"
        ) {

          sendToCamera(
            msg.cameraId,
            {

              type:
                "viewer-ice",

              cameraId:
                msg.cameraId,

              viewerId:
                msg.viewerId,

              candidate:
                msg.candidate

            }
          );


          return;

        }


        /* =================================
           UNKNOWN MESSAGE
        ================================= */

        console.log(
          "Unknown message:",
          msg.type
        );

      }
    );


    /* =====================================
       SOCKET CLOSED
    ===================================== */

    ws.on(
      "close",
      () => {

        console.log(
          "Socket closed:",
          role,
          id
        );


        /* ================================
           CAMERA CLOSED
        ================================= */

        if (
          role ===
          "camera"
        ) {

          const camera =
            cameras.get(id);


          /*
            Important:
            Only remove the camera if
            this is still the active socket.

            This prevents an old socket
            from removing a newly
            reconnected camera.
          */

          if (
            camera &&
            camera.ws === ws
          ) {

            cameras.delete(id);


            console.log(
              "CAMERA OFFLINE:",
              id
            );


            broadcastCameraOffline(
              id
            );

          }


          return;

        }


        /* ================================
           VIEWER CLOSED
        ================================= */

        if (
          role ===
          "viewer"
        ) {

          const viewer =
            viewers.get(id);


          /*
            Only delete if this is
            still the active viewer socket.
          */

          if (
            viewer === ws
          ) {

            viewers.delete(id);

          }


          console.log(
            "VIEWER OFFLINE:",
            id
          );


          return;

        }

      }
    );


    /* =====================================
       SOCKET ERROR
    ===================================== */

    ws.on(
      "error",
      err => {

        console.error(
          "WebSocket error:",
          err.message
        );

      }
    );

  }
);


/* =========================================
   SERVER ERROR
========================================= */

server.on(
  "error",
  err => {

    console.error(
      "HTTP server error:",
      err
    );

  }
);


/* =========================================
   START SERVER
========================================= */

server.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      "Server running on port:",
      PORT
    );

    console.log(
      "Camera: /"
    );

    console.log(
      "Viewer: /viewer"
    );

    console.log(
      "Video + Audio WebRTC signaling ready"
    );

    console.log(
      "================================="
    );

  }
);
