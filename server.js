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


  fs.readFile(
    path.join(__dirname, fileName),
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

const cameras =
  new Map();

const viewers =
  new Map();


/* =========================================
   SEND HELPER
========================================= */

function send(ws, data) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {

    try {

      ws.send(
        JSON.stringify(data)
      );

    } catch (err) {

      console.error(
        "Send error:",
        err
      );

    }

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

    return;

  }


  send(
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

    return;

  }


  send(
    viewer,
    data
  );

}


/* =========================================
   CONNECTION
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
            "Invalid JSON"
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

          role =
            "camera";

          id =
            msg.cameraId;


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
            Tell every connected viewer
            that this camera is available.
          */

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
                  id

              }
            );

          }


          return;

        }


        /* =================================
           REGISTER VIEWER
        ================================= */

        if (
          msg.type ===
          "register-viewer"
        ) {

          role =
            "viewer";

          id =
            msg.viewerId;


          viewers.set(
            id,
            ws
          );


          console.log(
            "VIEWER ONLINE:",
            id
          );


          /*
            Send all currently online
            cameras to this viewer.
          */

          for (
            const cameraId
            of cameras.keys()
          ) {

            send(
              ws,
              {

                type:
                  "camera-online",

                cameraId:
                  cameraId

              }
            );

          }


          return;

        }


        /* =================================
           WATCH CAMERA
        ================================= */

        if (
          msg.type ===
          "watch-camera"
        ) {

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
           CAMERA OFFER → VIEWER
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
           VIEWER ANSWER → CAMERA
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
           CAMERA ICE → VIEWER
        ================================= */

        if (
          msg.type ===
          "camera-ice"
        ) {

          console.log(
            "CAMERA ICE:",
            msg.cameraId,
            "→",
            msg.viewerId
          );


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
           VIEWER ICE → CAMERA
        ================================= */

        if (
          msg.type ===
          "viewer-ice"
        ) {

          console.log(
            "VIEWER ICE:",
            msg.viewerId,
            "→",
            msg.cameraId
          );


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


        /* CAMERA OFFLINE */

        if (
          role ===
          "camera"
        ) {

          const camera =
            cameras.get(id);


          /*
            Only remove it if this exact
            WebSocket is still registered.
          */

          if (
            camera &&
            camera.ws === ws
          ) {

            cameras.delete(id);

          }


          console.log(
            "CAMERA OFFLINE:",
            id
          );


          /*
            Tell viewers.
          */

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
                  id

              }
            );

          }

        }


        /* VIEWER OFFLINE */

        if (
          role ===
          "viewer"
        ) {

          const viewer =
            viewers.get(id);


          if (
            viewer === ws
          ) {

            viewers.delete(id);

          }


          console.log(
            "VIEWER OFFLINE:",
            id
          );

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
      "================================="
    );

  }
);
