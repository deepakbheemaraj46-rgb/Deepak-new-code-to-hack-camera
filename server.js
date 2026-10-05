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

    return res.end("Not Found");

  }

  fs.readFile(

    path.join(__dirname, fileName),

    (err, data) => {

      if (err) {

        res.writeHead(500);

        return res.end("File Error");

      }

      res.writeHead(200, {
        "Content-Type":
          "text/html; charset=utf-8",
        "Cache-Control":
          "no-store"
      });

      res.end(data);

    }

  );

});

const wss =
  new WebSocket.Server({
    server
  });

const cameras =
  new Map();

const viewers =
  new Map();

function send(
  ws,
  data
) {

  if (
    ws &&
    ws.readyState ===
      WebSocket.OPEN
  ) {

    ws.send(
      JSON.stringify(data)
    );

  }

}

function sendToViewer(
  viewerId,
  data
) {

  send(
    viewers.get(viewerId),
    data
  );

}

function sendToCamera(
  cameraId,
  data
) {

  const camera =
    cameras.get(cameraId);

  if (!camera)
    return;

  send(
    camera.ws,
    data
  );

}

wss.on(
  "connection",
  ws => {

    let role = null;

    let id =
      crypto.randomUUID();

    console.log(
      "Socket connected"
    );

    ws.on(
      "message",
      raw => {

        let msg;

        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        } catch {

          return;

        }

        /*
         CAMERA REGISTER
        */

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
              ws
            }
          );

          console.log(
            "Camera registered:",
            id
          );

          for (
            const viewerId of
            viewers.keys()
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

        /*
         VIEWER REGISTER
        */

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
            "Viewer registered:",
            id
          );

          for (
            const cameraId of
            cameras.keys()
          ) {

            send(
              ws,
              {
                type:
                  "camera-online",

                cameraId
              }
            );

          }

          return;

        }

        /*
         WATCH CAMERA
        */

        if (
          msg.type ===
          "watch-camera"
        ) {

          console.log(
            "Watch request:",
            msg.cameraId
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

        /*
         OFFER
        */

        if (
          msg.type ===
          "offer"
        ) {

          sendToViewer(
            msg.viewerId,
            msg
          );

          return;

        }

        /*
         ANSWER
        */

        if (
          msg.type ===
          "answer"
        ) {

          sendToCamera(
            msg.cameraId,
            msg
          );

          return;

        }

        /*
         CAMERA ICE
        */

        if (
          msg.type ===
          "camera-ice"
        ) {

          sendToViewer(
            msg.viewerId,
            msg
          );

          return;

        }

        /*
         VIEWER ICE
        */

        if (
          msg.type ===
          "viewer-ice"
        ) {

          sendToCamera(
            msg.cameraId,
            msg
          );

          return;

        }

      }

    );

    ws.on(
      "close",
      () => {

        console.log(
          "Socket closed",
          id
        );

        if (
          role ===
          "camera"
        ) {

          cameras.delete(
            id
          );

          for (
            const viewerId of
            viewers.keys()
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

          console.log(
            "Camera offline:",
            id
          );

        }

        if (
          role ===
          "viewer"
        ) {

          viewers.delete(
            id
          );

          console.log(
            "Viewer offline:",
            id
          );

        }

      }

    );

  }

);

server.listen(
  PORT,
  () => {

    console.log(
      `Server running on ${PORT}`
    );

  }
);
  
