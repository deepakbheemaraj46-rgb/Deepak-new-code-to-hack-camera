const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;


function makeId() {

  return (
    Math.random()
      .toString(36)
      .slice(2, 8)
    +
    Date.now()
      .toString(36)
      .slice(-6)
  );

}


function send(ws, message) {

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {

    ws.send(
      JSON.stringify(message)
    );

  }

}


const server = http.createServer(
  (req, res) => {

    const routes = {

      "/":
        "camera.html",

      "/camera":
        "camera.html",

      "/camera.html":
        "camera.html",

      "/viewer":
        "viewer.html",

      "/viewer.html":
        "viewer.html"

    };


    const pathname =
      new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`
      ).pathname;


    const file =
      routes[pathname];


    if (!file) {

      res.writeHead(404);

      return res.end(
        "Not found"
      );

    }


    fs.readFile(
      path.join(
        __dirname,
        file
      ),
      (err, data) => {

        if (err) {

          res.writeHead(500);

          return res.end(
            "Server error"
          );

        }


        res.writeHead(
          200,
          {

            "Content-Type":
              "text/html; charset=utf-8",

            "Cache-Control":
              "no-store"

          }
        );


        res.end(data);

      }
    );

  }
);


const wss =
  new WebSocket.Server({
    server
  });


const cameras =
  new Map();


const viewers =
  new Map();



wss.on(
  "connection",
  (ws, req) => {

    const pathname =
      new URL(
        req.url,
        "http://localhost"
      ).pathname;


    // Reject unknown WebSocket paths

    if (
      pathname !== "/camera" &&
      pathname !== "/viewer"
    ) {

      ws.close();

      return;

    }


    // =================================
    // CAMERA
    // =================================

    if (
      pathname === "/camera"
    ) {

      const cameraId =
        makeId();


      // IMPORTANT:
      // Store camera connection AND
      // whether permission was granted.

      const camera = {

        ws: ws,

        live: false,

        cameras: {

          front: false,

          back: false

        }

      };


      cameras.set(
        cameraId,
        camera
      );


      send(
        ws,
        {

          type: "role",

          role: "camera",

          cameraId: cameraId

        }
      );


      // Tell current viewers that a
      // new camera page connected.

      for (
        const viewer
        of viewers.values()
      ) {

        send(
          viewer.ws,
          {

            type:
              "camera-online",

            cameraId:
              cameraId

          }
        );

      }


      ws.on(
        "message",
        raw => {

          let msg;


          try {

            msg =
              JSON.parse(
                raw.toString()
              );

          }

          catch {

            return;

          }


          // =============================
          // CAMERA PERMISSION GRANTED
          // =============================

          if (
            msg.type ===
            "camera-live"
          ) {

            const wasLive =
              camera.live;


            camera.live =
              true;


            camera.cameras =
              msg.cameras || {

                front: true,

                back: false

              };


            // Notify every viewer.

            for (
              const [
                viewerId,
                viewer
              ]
              of viewers.entries()
            ) {

              send(
                viewer.ws,
                {

                  type:
                    "camera-live",

                  cameraId:
                    cameraId,

                  cameras:
                    camera.cameras

                }
              );


              // IMPORTANT:
              // Tell the camera to create a
              // WebRTC offer for every viewer
              // after permission is granted.

              send(
                ws,
                {

                  type:
                    "viewer-ready",

                  viewerId:
                    viewerId

                }
              );

            }


            return;

          }


          // =============================
          // CAMERA -> VIEWER
          // OFFER / CANDIDATE
          // =============================

          if (
            msg.toViewerId
          ) {

            const viewer =
              viewers.get(
                msg.toViewerId
              );


            if (viewer) {

              send(
                viewer.ws,
                {

                  ...msg,

                  cameraId:
                    cameraId

                }
              );

            }

          }

        }
      );


      ws.on(
        "close",
        () => {

          const current =
            cameras.get(
              cameraId
            );


          if (
            !current ||
            current.ws !== ws
          ) {

            return;

          }


          cameras.delete(
            cameraId
          );


          for (
            const viewer
            of viewers.values()
          ) {

            send(
              viewer.ws,
              {

                type:
                  "camera-offline",

                cameraId:
                  cameraId

              }
            );

          }

        }
      );


      ws.on(
        "error",
        () => {}
      );


      return;

    }



    // =================================
    // VIEWER
    // =================================

    const viewerId =
      makeId();


    const viewer = {

      id: viewerId,

      ws: ws

    };


    viewers.set(
      viewerId,
      viewer
    );


    // Send all current camera IDs.

    send(
      ws,
      {

        type: "role",

        role: "viewer",

        viewerId: viewerId,

        cameras:
          [
            ...cameras.keys()
          ]

      }
    );


    // Tell the new viewer about every
    // camera and which cameras are live.

    for (
      const [
        cameraId,
        camera
      ]
      of cameras.entries()
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


      if (
        camera.live
      ) {

        send(
          ws,
          {

            type:
              "camera-live",

            cameraId:
              cameraId,

            cameras:
              camera.cameras

          }
        );


        // Ask the camera to create
        // a fresh offer for this viewer.

        send(
          camera.ws,
          {

            type:
              "viewer-ready",

            viewerId:
              viewerId

          }
        );

      }

    }


    ws.on(
      "message",
      raw => {

        let msg;


        try {

          msg =
            JSON.parse(
              raw.toString()
            );

        }

        catch {

          return;

        }


        // =============================
        // VIEWER WANTS CAMERA
        // =============================

        if (
          msg.type ===
          "viewer-ready" &&
          msg.cameraId
        ) {

          const camera =
            cameras.get(
              msg.cameraId
            );


          if (camera) {

            send(
              camera.ws,
              {

                type:
                  "viewer-ready",

                viewerId:
                  viewerId

              }
            );

          }


          return;

        }


        // =============================
        // VIEWER -> CAMERA
        // ANSWER / CANDIDATE
        // =============================

        if (
          msg.cameraId
        ) {

          const camera =
            cameras.get(
              msg.cameraId
            );


          if (camera) {

            send(
              camera.ws,
              {

                ...msg,

                toViewerId:
                  viewerId

              }
            );

          }

        }

      }
    );


    ws.on(
      "close",
      () => {

        viewers.delete(
          viewerId
        );


        // Tell all cameras to close
        // the peer for this viewer.

        for (
          const camera
          of cameras.values()
        ) {

          send(
            camera.ws,
            {

              type:
                "viewer-left",

              viewerId:
                viewerId

            }
          );

        }

      }
    );


    ws.on(
      "error",
      () => {}
    );

  }
);


server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
