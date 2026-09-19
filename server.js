const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";


/* =========================================
   NTFY
========================================= */

function sendNtfy(message) {

    const topic = NTFY_TOPIC.trim();

    if (!topic) {
        console.log("NTFY_TOPIC not configured");
        return;
    }

    const data = Buffer.from(message, "utf8");

    const req = https.request({
        hostname: "ntfy.sh",
        port: 443,
        path: "/" + encodeURIComponent(topic),
        method: "POST",

        headers: {
            "Content-Type":
                "text/plain; charset=utf-8",

            "Content-Length":
                data.length,

            "Title":
                "Camera Awareness Demo",

            "Priority":
                "high"
        }

    }, res => {

        console.log(
            "ntfy status:",
            res.statusCode
        );

        res.on("data", () => {});
    });

    req.on("error", error => {
        console.error(
            "ntfy error:",
            error.message
        );
    });

    req.write(data);
    req.end();
}


/* =========================================
   SEND
========================================= */

function send(ws, message) {

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(message)
        );

        return true;
    }

    return false;
}


/* =========================================
   ID
========================================= */

function makeId() {

    return (
        Math.random()
            .toString(36)
            .slice(2, 8)
        +
        Date.now()
            .toString(36)
            .slice(-5)
    );
}


/* =========================================
   HTTP
========================================= */

const server =
    http.createServer((req, res) => {

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

        let pathname;

        try {

            pathname =
                new URL(
                    req.url,
                    `http://${req.headers.host || "localhost"}`
                ).pathname;

        } catch {

            res.writeHead(400);
            return res.end("Bad request");
        }

        const file =
            routes[pathname];

        if (!file) {

            res.writeHead(404);
            return res.end("Not found");
        }

        fs.readFile(
            path.join(__dirname, file),
            (err, data) => {

                if (err) {

                    console.error(err);

                    res.writeHead(500);
                    return res.end(
                        "Server error"
                    );
                }

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html; charset=utf-8"
                    }
                );

                res.end(data);
            }
        );
    });


/* =========================================
   WEBSOCKET
========================================= */

const wss =
    new WebSocket.Server({
        server
    });


const cameras = new Map();
const viewers = new Map();


/* =========================================
   CONNECTION
========================================= */

wss.on(
    "connection",
    (ws, req) => {

        let pathname;

        try {

            pathname =
                new URL(
                    req.url,
                    "http://localhost"
                ).pathname;

        } catch {

            ws.close();
            return;
        }


        /* =================================
           CAMERA
        ================================= */

        if (pathname === "/camera") {

            const cameraId =
                makeId();

            cameras.set(
                cameraId,
                ws
            );

            ws.cameraLive = false;

            console.log(
                "Camera connected:",
                cameraId
            );


            sendNtfy(
                "🟢 Camera browser connected"
            );


            send(
                ws,
                {
                    type: "role",
                    role: "camera",
                    cameraId
                }
            );


            /* Tell existing viewers */

            for (
                const viewer
                of viewers.values()
            ) {

                send(
                    viewer,
                    {
                        type:
                            "camera-online",

                        cameraId
                    }
                );
            }


            /* Camera messages */

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


                    /* =====================
                       CAMERA LIVE
                    ===================== */

                    if (
                        msg.type ===
                        "camera-live"
                    ) {

                        ws.cameraLive =
                            true;

                        for (
                            const viewer
                            of viewers.values()
                        ) {

                            send(
                                viewer,
                                {
                                    type:
                                        "camera-live",

                                    cameraId
                                }
                            );
                        }

                        return;
                    }


                    /* =====================
                       CAMERA SWITCH
                    ===================== */

                    if (
                        msg.type ===
                        "camera-switch"
                    ) {

                        const mode =
                            msg.mode === "environment"
                                ? "environment"
                                : "user";


                        send(
                            ws,
                            {
                                type:
                                    "switch-camera",

                                mode
                            }
                        );


                        sendNtfy(
                            `📷 Camera switch requested: ${mode}`
                        );

                        return;
                    }


                    /* =====================
                       WEBRTC
                    ===================== */

                    if (
                        msg.toViewerId
                    ) {

                        const viewer =
                            viewers.get(
                                String(
                                    msg.toViewerId
                                )
                            );

                        if (viewer) {

                            send(
                                viewer,
                                {
                                    ...msg,
                                    cameraId
                                }
                            );
                        }

                        return;
                    }

                }
            );


            /* Camera disconnected */

            ws.on(
                "close",
                () => {

                    if (
                        cameras.get(
                            cameraId
                        ) !== ws
                    ) {

                        return;
                    }

                    cameras.delete(
                        cameraId
                    );


                    console.log(
                        "Camera disconnected:",
                        cameraId
                    );


                    sendNtfy(
                        "🔴 Camera browser disconnected"
                    );


                    for (
                        const viewer
                        of viewers.values()
                    ) {

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


            return;
        }


        /* =================================
           VIEWER
        ================================= */

        if (pathname === "/viewer") {

            const viewerId =
                makeId();

            viewers.set(
                viewerId,
                ws
            );


            console.log(
                "Viewer connected:",
                viewerId
            );


            send(
                ws,
                {
                    type: "role",
                    role: "viewer",
                    viewerId,

                    cameras:
                        [...cameras.keys()]
                }
            );


            /* Current cameras */

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

                        cameraId
                    }
                );


                if (
                    camera.cameraLive
                ) {

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


            /* Viewer messages */

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


                    /* =====================
                       START VIEWING
                    ===================== */

                    if (
                        msg.type ===
                        "viewer-ready" &&
                        msg.cameraId
                    ) {

                        const camera =
                            cameras.get(
                                String(
                                    msg.cameraId
                                )
                            );


                        if (!camera) {

                            send(
                                ws,
                                {
                                    type:
                                        "camera-offline",

                                    cameraId:
                                        msg.cameraId
                                }
                            );

                            return;
                        }


                        send(
                            camera,
                            {
                                type:
                                    "viewer-ready",

                                viewerId
                            }
                        );


                        return;
                    }


                    /* =====================
                       WEBRTC
                    ===================== */

                    if (
                        msg.cameraId
                    ) {

                        const camera =
                            cameras.get(
                                String(
                                    msg.cameraId
                                )
                            );


                        if (!camera) {
                            return;
                        }


                        send(
                            camera,
                            {
                                ...msg,

                                toViewerId:
                                    viewerId
                            }
                        );
                    }

                }
            );


            /* Viewer disconnected */

            ws.on(
                "close",
                () => {

                    viewers.delete(
                        viewerId
                    );


                    for (
                        const camera
                        of cameras.values()
                    ) {

                        send(
                            camera,
                            {
                                type:
                                    "viewer-offline",

                                viewerId
                            }
                        );
                    }
                }
            );

            return;
        }


        ws.close();
    });


/* =========================================
   START
========================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            "NTFY:",
            NTFY_TOPIC
                ? "configured"
                : "not configured"
        );
    }
);
