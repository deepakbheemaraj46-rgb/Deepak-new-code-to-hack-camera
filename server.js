const http =
  require("http");

const fs =
  require("fs");

const path =
  require("path");

const WebSocket =
  require("ws");


const PORT =
  process.env.PORT ||
  10000;


function makeId(){

  return (

    Math.random()
      .toString(36)
      .slice(2,8)

    +

    Date.now()
      .toString(36)
      .slice(-6)

  );

}


function send(
  ws,
  message
){

  if(
    ws &&
    ws.readyState ===
    WebSocket.OPEN
  ){

    ws.send(
      JSON.stringify(
        message
      )
    );

  }

}


/*
  HTTP SERVER
*/

const server =
  http.createServer(
    (req,res) => {

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
        )
        .pathname;


      const file =
        routes[pathname];


      if(!file){

        res.writeHead(404);

        res.end(
          "Not found"
        );

        return;

      }


      fs.readFile(

        path.join(
          __dirname,
          file
        ),

        (err,data) => {

          if(err){

            res.writeHead(500);

            res.end(
              "Server error"
            );

            return;

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

  (ws,req) => {

    const pathname =
      new URL(
        req.url,
        "http://localhost"
      )
      .pathname;


    /*
      CAMERA CONNECTION
    */

    if(
      pathname ===
      "/camera"
    ){

      const cameraId =
        makeId();


      ws.cameraLive =
        false;


      cameras.set(
        cameraId,
        ws
      );


      send(
        ws,
        {

          type:"role",

          role:"camera",

          cameraId

        }
      );


      /*
        Tell all viewers
        that a camera connected
      */

      for(
        const [
          viewerId,
          viewer
        ]
        of viewers
      ){

        send(
          viewer,
          {

            type:
              "camera-online",

            cameraId

          }
        );

      }


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

          catch{

            return;

          }


          /*
            CAMERA IS LIVE
          */

          if(
            msg.type ===
            "camera-live"
          ){

            ws.cameraLive =
              true;


            for(
              const [
                viewerId,
                viewer
              ]
              of viewers
            ){

              send(
                viewer,
                {

                  type:
                    "camera-live",

                  cameraId,

                  cameras:
                    msg.cameras

                }
              );


              /*
                Ask camera to create
                WebRTC offer for viewer
              */

              send(
                ws,
                {

                  type:
                    "viewer-ready",

                  viewerId

                }
              );

            }


            return;

          }


          /*
            CAMERA -> VIEWER

            Offer
            ICE candidate
          */

          if(
            msg.toViewerId
          ){

            const viewer =
              viewers.get(
                msg.toViewerId
              );


            if(viewer){

              send(
                viewer,
                {

                  ...msg,

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

          if(
            cameras.get(
              cameraId
            ) !== ws
          ){

            return;

          }


          cameras.delete(
            cameraId
          );


          for(
            const viewer
            of viewers.values()
          ){

            send(
              viewer,
              {

                type:
                  "camera-offline",

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


    /*
      VIEWER CONNECTION
    */

    if(
      pathname ===
      "/viewer"
    ){

      const viewerId =
        makeId();


      viewers.set(
        viewerId,
        ws
      );


      /*
        Send current cameras
      */

      send(
        ws,
        {

          type:"role",

          role:"viewer",

          viewerId,

          cameras:
            [
              ...cameras.keys()
            ]

        }
      );


      /*
        Tell viewer which
        cameras are already live
      */

      for(
        const [
          cameraId,
          camera
        ]
        of cameras
      ){

        if(
          camera.cameraLive
        ){

          send(
            ws,
            {

              type:
                "camera-live",

              cameraId

            }
          );

        }

      }


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

          catch{

            return;

          }


          /*
            VIEWER REQUESTS STREAM
          */

          if(
            msg.type ===
            "viewer-ready" &&

            msg.cameraId
          ){

            const camera =
              cameras.get(
                msg.cameraId
              );


            if(camera){

              send(
                camera,
                {

                  type:
                    "viewer-ready",

                  viewerId

                }
              );

            }


            return;

          }


          /*
            VIEWER -> CAMERA

            Answer
            ICE candidate
          */

          if(
            msg.cameraId
          ){

            const camera =
              cameras.get(
                msg.cameraId
              );


            if(camera){

              send(
                camera,
                {

                  ...msg,

                  viewerId,

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


          /*
            Tell cameras
            viewer disconnected
          */

          for(
            const camera
            of cameras.values()
          ){

            send(
              camera,
              {

                type:
                  "viewer-left",

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


      return;

    }


    ws.close();

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
