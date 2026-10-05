"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;


const server =
  http.createServer((req,res) => {

    let file;

    if(req.url === "/"){
      file = "camera.html";
    }
    else if(req.url === "/viewer"){
      file = "viewer.html";
    }
    else{
      res.writeHead(404);
      return res.end("Not Found");
    }


    const filePath =
      path.join(__dirname,file);


    fs.readFile(
      filePath,
      (err,data) => {

        if(err){

          console.error(err);

          res.writeHead(500);

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
              "no-store"
          }
        );


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


function send(ws,data){

  if(
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ){
    return;
  }


  try{

    ws.send(
      JSON.stringify(data)
    );

  }catch(error){

    console.error(
      "SEND ERROR:",
      error.message
    );

  }

}


wss.on(
  "connection",
  ws => {

    let role = null;
    let id = crypto.randomUUID();


    console.log(
      "WebSocket connected"
    );


    ws.on(
      "message",
      raw => {

        let msg;

        try{

          msg =
            JSON.parse(
              raw.toString()
            );

        }catch{

          return;

        }


        /* CAMERA */

        if(
          msg.type ===
          "register-camera"
        ){

          role = "camera";

          id =
            msg.cameraId;


          cameras.set(
            id,
            ws
          );


          console.log(
            "CAMERA ONLINE:",
            id
          );


          for(
            const viewer of viewers.values()
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


        /* VIEWER */

        if(
          msg.type ===
          "register-viewer"
        ){

          role = "viewer";

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


          for(
            const cameraId of cameras.keys()
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


        /* WATCH */

        if(
          msg.type ===
          "watch-camera"
        ){

          const camera =
            cameras.get(
              msg.cameraId
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


        /* OFFER */

        if(
          msg.type === "offer"
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


        /* ANSWER */

        if(
          msg.type === "answer"
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


        /* CAMERA ICE */

        if(
          msg.type === "camera-ice"
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


        /* VIEWER ICE */

        if(
          msg.type === "viewer-ice"
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


    ws.on(
      "close",
      () => {

        if(role === "camera"){

          if(
            cameras.get(id) === ws
          ){

            cameras.delete(id);

            for(
              const viewer of viewers.values()
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


        if(role === "viewer"){

          if(
            viewers.get(id) === ws
          ){

            viewers.delete(id);

          }

        }

      }
    );


    ws.on(
      "error",
      error => {

        console.error(
          "WebSocket error:",
          error.message
        );

      }
    );

  }
);


server.listen(
  PORT,
  () => {

    console.log(
      "================================"
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
      "FAST WEBRTC SIGNALING READY"
    );

    console.log(
      "================================"
    );

  }
);
