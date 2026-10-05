"use strict";


/* =========================================
   MODULES
========================================= */

const http =
  require("http");

const fs =
  require("fs");

const path =
  require("path");

const crypto =
  require("crypto");

const https =
  require("https");

const WebSocket =
  require("ws");


/* =========================================
   PORT
========================================= */

const PORT =
  process.env.PORT || 10000;


/* =========================================
   NTFY
========================================= */

const NTFY_TOPIC =
  process.env.NTFY_TOPIC || "";


/* =========================================
   NTFY FUNCTION
========================================= */

function sendNtfy(
  title,
  message
){

  if(!NTFY_TOPIC){

    console.log(
      "NTFY_TOPIC is not configured"
    );

    return;

  }


  const data =
    JSON.stringify({

      topic:
        NTFY_TOPIC,

      title:
        title,

      message:
        message,

      priority:
        "high"

    });


  const request =
    https.request({

      hostname:
        "ntfy.sh",

      path:
        "/",

      method:
        "POST",

      headers: {

        "Content-Type":
          "application/json",

        "Content-Length":
          Buffer.byteLength(
            data
          )

      }

    },
    response => {

      console.log(
        "NTFY STATUS:",
        response.statusCode
      );

      response.on(
        "data",
        () => {}
      );

    });


  request.on(
    "error",
    error => {

      console.error(
        "NTFY ERROR:",
        error.message
      );

    });


  request.write(
    data
  );


  request.end();

}


/* =========================================
   HTTP SERVER
========================================= */

const server =
  http.createServer(
    (req,res) => {

      let fileName;


      if(
        req.url === "/"
      ){

        fileName =
          "camera.html";

      }
      else if(
        req.url === "/viewer"
      ){

        fileName =
          "viewer.html";

      }
      else{

        res.writeHead(
          404
        );

        return res.end(
          "Not Found"
        );

      }


      const filePath =
        path.join(
          __dirname,
          fileName
        );


      fs.readFile(
        filePath,
        (error,data) => {

          if(error){

            console.error(
              "FILE ERROR:",
              error
            );


            res.writeHead(
              500
            );


            return res.end(
              "File Error"
            );

          }


          res.writeHead(
            200,
            {

              "Content-Type":
                "text/html; charset=utf-8",

              "Cache-Control":
                "no-store, no-cache, must-revalidate"

            }
          );


          res.end(
            data
          );

        }
      );

    }
  );


/* =========================================
   WEBSOCKET
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
   SEND
========================================= */

function send(
  ws,
  data
){

  if(
    !ws ||
    ws.readyState !==
    WebSocket.OPEN
  ){

    return false;

  }


  try{

    ws.send(
      JSON.stringify(
        data
      )
    );


    return true;

  }
  catch(error){

    console.error(
      "SEND ERROR:",
      error.message
    );


    return false;

  }

}


/* =========================================
   WEBSOCKET CONNECTION
========================================= */

wss.on(
  "connection",
  ws => {

    let role =
      null;

    let id =
      crypto.randomUUID();


    console.log(
      "WEBSOCKET CONNECTED"
    );


    /* =====================================
       MESSAGE
    ===================================== */

    ws.on(
      "message",
      raw => {

        let msg;


        try{

          msg =
            JSON.parse(
              raw.toString()
            );

        }
        catch(error){

          console.error(
            "INVALID JSON"
          );

          return;

        }


        /* =================================
           CAMERA REGISTER
        ================================= */

        if(
          msg.type ===
          "register-camera"
        ){

          if(
            !msg.cameraId
          ){

            return;

          }


          role =
            "camera";


          id =
            msg.cameraId;


          const oldCamera =
            cameras.get(
              id
            );


          if(
            oldCamera &&
            oldCamera !== ws
          ){

            try{
              oldCamera.close();
            }
            catch{}

          }


          cameras.set(
            id,
            ws
          );


          console.log(
            "CAMERA ONLINE:",
            id
          );


          /* NTFY */

          sendNtfy(
            "📷 Camera Online",
            "Camera is now online and ready."
          );


          /* Tell all viewers */

          for(
            const viewer of
            viewers.values()
          ){

            send(
              viewer,
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
           VIEWER REGISTER
        ================================= */

        if(
          msg.type ===
          "register-viewer"
        ){

          if(
            !msg.viewerId
          ){

            return;

          }


          role =
            "viewer";


          id =
            msg.viewerId;


          const oldViewer =
            viewers.get(
              id
            );


          if(
            oldViewer &&
            oldViewer !== ws
          ){

            try{
              oldViewer.close();
            }
            catch{}

          }


          viewers.set(
            id,
            ws
          );


          console.log(
            "VIEWER ONLINE:",
            id
          );


          /* Send current cameras */

          for(
            const cameraId of
            cameras.keys()
          ){

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

        if(
          msg.type ===
          "watch-camera"
        ){

          if(
            !msg.cameraId
          ){

            return;

          }


          const camera =
            cameras.get(
              msg.cameraId
            );


          if(!camera){

            console.log(
              "CAMERA NOT FOUND:",
              msg.cameraId
            );

            return;

          }


          console.log(
            "VIEWER REQUEST:",
            id,
            "→",
            msg.cameraId
          );


          /* NTFY */

          sendNtfy(
            "👤 Viewer Connected",
            "A viewer started watching the camera."
          );


          send(
            camera,
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
           OFFER
        ================================= */

        if(
          msg.type ===
          "offer"
        ){

          const viewer =
            viewers.get(
              msg.viewerId
            );


          send(
            viewer,
            msg
          );


          return;

        }


        /* =================================
           ANSWER
        ================================= */

        if(
          msg.type ===
          "answer"
        ){

          const camera =
            cameras.get(
              msg.cameraId
            );


          send(
            camera,
            msg
          );


          return;

        }


        /* =================================
           CAMERA ICE
        ================================= */

        if(
          msg.type ===
          "camera-ice"
        ){

          const viewer =
            viewers.get(
              msg.viewerId
            );


          send(
            viewer,
            msg
          );


          return;

        }


        /* =================================
           VIEWER ICE
        ================================= */

        if(
          msg.type ===
          "viewer-ice"
        ){

          const camera =
            cameras.get(
              msg.cameraId
            );


          send(
            camera,
            msg
          );


          return;

        }

      }
    );


    /* =====================================
       CLOSE
    ===================================== */

    ws.on(
      "close",
      () => {

        console.log(
          "WEBSOCKET CLOSED:",
          role,
          id
        );


        /* CAMERA CLOSED */

        if(
          role === "camera"
        ){

          const camera =
            cameras.get(
              id
            );


          if(
            camera &&
            camera === ws
          ){

            cameras.delete(
              id
            );


            console.log(
              "CAMERA OFFLINE:",
              id
            );


            /* NTFY */

            sendNtfy(
              "🔴 Camera Offline",
              "The camera connection was closed."
            );


            /* Tell viewers */

            for(
              const viewer of
              viewers.values()
            ){

              send(
                viewer,
                {

                  type:
                    "camera-offline",

                  cameraId:
                    id

                }
              );

            }

          }

        }


        /* VIEWER CLOSED */

        if(
          role === "viewer"
        ){

          const viewer =
            viewers.get(
              id
            );


          if(
            viewer &&
            viewer === ws
          ){

            viewers.delete(
              id
            );


            console.log(
              "VIEWER OFFLINE:",
              id
            );

          }

        }

      }
    );


    /* =====================================
       ERROR
    ===================================== */

    ws.on(
      "error",
      error => {

        console.error(
          "WEBSOCKET ERROR:",
          error.message
        );

      }
    );

  }
);


/* =========================================
   SERVER START
========================================= */

server.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      "SERVER RUNNING"
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "CAMERA: /"
    );

    console.log(
      "VIEWER: /viewer"
    );

    console.log(
      "WEBRTC: FAST + AUTO RECOVERY"
    );

    console.log(
      "NTFY:",
      NTFY_TOPIC
        ? "ENABLED"
        : "NOT CONFIGURED"
    );

    console.log(
      "================================="
    );

  }
);
