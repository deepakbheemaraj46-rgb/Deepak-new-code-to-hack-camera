"use strict";

/* =========================================
   ELEMENTS
========================================= */

const status = document.getElementById("status");
const idBox = document.getElementById("id");

const permissionGate =
  document.getElementById("permissionGate");

const allowCameraBtn =
  document.getElementById("allowCameraBtn");

const declineCameraBtn =
  document.getElementById("declineCameraBtn");

const permissionMessage =
  document.getElementById("permissionMessage");

const mainContent =
  document.getElementById("mainContent");

const blockedMessage =
  document.getElementById("blockedMessage");

const cameraIndicator =
  document.getElementById("cameraIndicator");


/* =========================================
   STATE
========================================= */

let stream = null;
let cameraId = null;
let roleReceived = false;
let permissionAllowed = false;

let ws = null;
let reconnectTimer = null;
let reconnectAttempt = 0;

let pageUnloading = false;
let intentionallyClosed = false;


/*
  viewerId -> RTCPeerConnection
*/
const peers = new Map();


/*
  viewerId -> ICE candidates
*/
const pendingCandidates = new Map();


/*
  Prevent duplicate offers.
*/
const creatingOffers = new Set();


/* =========================================
   WEBSOCKET URL
========================================= */

const wsUrl =
  (location.protocol === "https:" ? "wss:" : "ws:") +
  "//" +
  location.host +
  "/camera";


/* =========================================
   SEND MESSAGE
========================================= */

function sendMessage(message) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {

    ws.send(JSON.stringify(message));

    return true;

  } catch (error) {

    console.error(
      "WebSocket send error:",
      error
    );

    return false;
  }
}


/* =========================================
   CAMERA LIVE
========================================= */

function announceCameraLive() {

  if (
    !permissionAllowed ||
    !stream ||
    !roleReceived
  ) {
    return;
  }

  sendMessage({
    type: "camera-live"
  });
}


/* =========================================
   CLOSE PEER
========================================= */

function closePeer(viewerId) {

  const pc = peers.get(viewerId);

  if (pc) {

    try {
      pc.close();
    } catch (error) {}

  }

  peers.delete(viewerId);
  pendingCandidates.delete(viewerId);
  creatingOffers.delete(viewerId);
}


/* =========================================
   CLOSE ALL PEERS
========================================= */

function closeAllPeers() {

  for (const viewerId of peers.keys()) {
    closePeer(viewerId);
  }

}


/* =========================================
   SHOW MAIN
========================================= */

function allowUserAccess() {

  permissionGate.style.display = "none";
  blockedMessage.style.display = "none";
  mainContent.style.display = "block";

}


/* =========================================
   BLOCK USER
========================================= */

function blockUser(message) {

  permissionGate.style.display = "none";
  mainContent.style.display = "none";
  blockedMessage.style.display = "block";

  permissionMessage.textContent = message;
}


/* =========================================
   CREATE PEER
========================================= */

function createPeer(viewerId) {

  let existing = peers.get(viewerId);

  if (existing) {

    const state = existing.connectionState;

    if (
      state !== "closed" &&
      state !== "failed"
    ) {
      return existing;
    }

    closePeer(viewerId);
  }


  const pc =
    new RTCPeerConnection({

      /*
        STUN servers.
        More reliable TURN may be needed
        for difficult networks.
      */

      iceServers: [

        {
          urls: "stun:stun.l.google.com:19302"
        },

        {
          urls: "stun:stun1.l.google.com:19302"
        }

      ],

      /*
        Prefer the video connection.
      */

      bundlePolicy: "max-bundle",

      rtcpMuxPolicy: "require"

    });


  peers.set(
    viewerId,
    pc
  );


  if (!pendingCandidates.has(viewerId)) {

    pendingCandidates.set(
      viewerId,
      []
    );

  }


  /* =======================================
     ADD CAMERA TRACK
  ======================================= */

  if (
    stream &&
    permissionAllowed
  ) {

    const tracks =
      stream.getTracks();

    for (const track of tracks) {

      try {

        pc.addTrack(
          track,
          stream
        );

      } catch (error) {

        console.error(
          "addTrack error:",
          error
        );

      }

    }

  }


  /* =======================================
     ICE
  ======================================= */

  pc.onicecandidate =
    event => {

      if (!event.candidate) {
        return;
      }

      sendMessage({

        type: "candidate",

        candidate:
          event.candidate,

        toViewerId:
          viewerId

      });

    };


  /* =======================================
     CONNECTION STATE
  ======================================= */

  pc.onconnectionstatechange =
    () => {

      const state =
        pc.connectionState;

      console.log(
        "WebRTC:",
        viewerId,
        state
      );


      if (state === "connecting") {

        status.textContent =
          "Connecting...";

      }


      if (state === "connected") {

        status.textContent =
          "Live";

      }


      if (state === "failed") {

        closePeer(viewerId);

        status.textContent =
          "Connection failed";

      }


      if (state === "closed") {

        closePeer(viewerId);

      }

    };


  /* =======================================
     ICE STATE
  ======================================= */

  pc.oniceconnectionstatechange =
    () => {

      console.log(
        "ICE:",
        viewerId,
        pc.iceConnectionState
      );

    };


  return pc;
}


/* =========================================
   CREATE OFFER
========================================= */

async function createOfferForViewer(
  viewerId
) {

  if (
    !viewerId ||
    !permissionAllowed ||
    !stream
  ) {
    return;
  }


  if (
    creatingOffers.has(viewerId)
  ) {
    return;
  }


  creatingOffers.add(viewerId);


  try {

    let pc =
      peers.get(viewerId);


    /*
      Reuse healthy connection.
    */

    if (pc) {

      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {

        closePeer(viewerId);

        pc = null;
      }

    }


    if (!pc) {

      pc =
        createPeer(viewerId);

    }


    /*
      Don't create another offer
      while negotiation is running.
    */

    if (
      pc.signalingState !== "stable"
    ) {

      console.log(
        "Skipping offer. State:",
        pc.signalingState
      );

      return;
    }


    const offer =
      await pc.createOffer({

        /*
          Keep normal WebRTC negotiation.
        */

        offerToReceiveAudio: false,
        offerToReceiveVideo: false

      });


    await pc.setLocalDescription(
      offer
    );


    /*
      Send only after local description
      is ready.
    */

    sendMessage({

      type: "offer",

      offer:
        pc.localDescription,

      toViewerId:
        viewerId

    });


    status.textContent =
      "Connecting...";

  }

  catch (error) {

    console.error(
      "Offer error:",
      error
    );

    closePeer(viewerId);

  }

  finally {

    creatingOffers.delete(
      viewerId
    );

  }
}


/* =========================================
   CAMERA PERMISSION
========================================= */

allowCameraBtn.onclick =
  async () => {

    allowCameraBtn.disabled =
      true;

    permissionMessage.textContent =
      "Please allow camera permission...";


    try {

      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {

        throw new Error(
          "Camera API unavailable"
        );

      }


      /*
        LOWER RESOLUTION + LOWER FPS
        = LESS BANDWIDTH
        = LESS LAG

        1280x720 at 24 FPS is a good
        starting point.
      */

      stream =
        await navigator.mediaDevices.getUserMedia({

          video: {

            width: {
              ideal: 1280,
              max: 1280
            },

            height: {
              ideal: 720,
              max: 720
            },

            frameRate: {
              ideal: 24,
              max: 30
            },

            facingMode: {
              ideal: "environment"
            }

          },

          audio: false

        });


      const videoTrack =
        stream.getVideoTracks()[0];


      if (!videoTrack) {

        throw new Error(
          "No camera track"
        );

      }


      /*
        Tell browser the camera settings
        we prefer.
      */

      try {

        await videoTrack.applyConstraints({

          width: {
            ideal: 1280,
            max: 1280
          },

          height: {
            ideal: 720,
            max: 720
          },

          frameRate: {
            ideal: 24,
            max: 30
          }

        });

      } catch (error) {

        console.log(
          "Camera constraints:",
          error
        );

      }


      console.log(
        "Camera settings:",
        videoTrack.getSettings()
      );


      permissionAllowed =
        true;


      cameraIndicator.style.display =
        "block";


      status.textContent =
        "Camera active";


      permissionMessage.textContent =
        "";


      allowUserAccess();


      /*
        Tell server camera is live.
      */

      announceCameraLive();

    }

    catch (error) {

      console.error(
        "Camera error:",
        error
      );


      if (stream) {

        stream
          .getTracks()
          .forEach(
            track => track.stop()
          );

      }


      stream = null;

      permissionAllowed =
        false;

      allowCameraBtn.disabled =
        false;


      blockUser(
        "Camera permission was not granted."
      );

    }

  };


/* =========================================
   DECLINE
========================================= */

declineCameraBtn.onclick =
  () => {

    permissionAllowed =
      false;

    closeAllPeers();


    if (stream) {

      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );

      stream = null;

    }


    blockUser(
      "Camera permission was not granted."
    );

  };


/* =========================================
   CONNECT WEBSOCKET
========================================= */

function connectWebSocket() {

  if (
    pageUnloading ||
    intentionallyClosed
  ) {
    return;
  }


  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }


  status.textContent =
    "Connecting...";


  const socket =
    new WebSocket(wsUrl);


  ws = socket;


  /* =======================================
     OPEN
  ======================================= */

  socket.onopen =
    () => {

      console.log(
        "WebSocket connected"
      );


      reconnectAttempt = 0;


      status.textContent =
        permissionAllowed
          ? "Camera active"
          : "Connected";


      if (
        permissionAllowed &&
        stream
      ) {

        announceCameraLive();

      }

    };


  /* =======================================
     MESSAGE
  ======================================= */

  socket.onmessage =
    async event => {

      let message;


      try {

        message =
          JSON.parse(
            event.data
          );

      } catch (error) {

        return;

      }


      /* =====================================
         ROLE
      ===================================== */

      if (
        message.type === "role"
      ) {

        closeAllPeers();


        cameraId =
          message.cameraId;


        roleReceived =
          true;


        idBox.textContent =
          "Camera ID: " +
          cameraId;


        if (
          permissionAllowed &&
          stream
        ) {

          announceCameraLive();

        }


        return;
      }


      /* =====================================
         VIEWER READY
      ===================================== */

      if (
        message.type === "viewer-ready"
      ) {

        const viewerId =
          message.viewerId;


        if (
          !viewerId ||
          !permissionAllowed ||
          !stream
        ) {
          return;
        }


        await createOfferForViewer(
          viewerId
        );


        return;
      }


      /* =====================================
         VIEWER OFFLINE
      ===================================== */

      if (
        message.type === "viewer-offline"
      ) {

        const viewerId =
          message.viewerId;


        if (viewerId) {

          closePeer(viewerId);

        }


        return;
      }


      /* =====================================
         ANSWER
      ===================================== */

      if (
        message.type === "answer"
      ) {

        const viewerId =
          message.toViewerId ||
          message.viewerId;


        if (
          !viewerId ||
          !message.answer
        ) {
          return;
        }


        const pc =
          peers.get(viewerId);


        if (!pc) {
          return;
        }


        try {

          if (
            pc.signalingState ===
            "have-local-offer"
          ) {

            await pc.setRemoteDescription(
              new RTCSessionDescription(
                message.answer
              )
            );

          }


          /*
            Add queued ICE candidates.
          */

          const candidates =
            pendingCandidates.get(
              viewerId
            ) || [];


          for (
            const candidate of candidates
          ) {

            try {

              await pc.addIceCandidate(
                new RTCIceCandidate(
                  candidate
                )
              );

            } catch (error) {

              console.log(
                "ICE candidate error:",
                error
              );

            }

          }


          pendingCandidates.set(
            viewerId,
            []
          );


        } catch (error) {

          console.error(
            "Answer error:",
            error
          );

          closePeer(viewerId);

        }


        return;
      }


      /* =====================================
         ICE CANDIDATE
      ===================================== */

      if (
        message.type === "candidate"
      ) {

        const viewerId =
          message.toViewerId ||
          message.viewerId;


        if (
          !viewerId ||
          !message.candidate
        ) {
          return;
        }


        const pc =
          peers.get(viewerId);


        /*
          Peer doesn't exist yet.
        */

        if (!pc) {

          if (
            !pendingCandidates.has(
              viewerId
            )
          ) {

            pendingCandidates.set(
              viewerId,
              []
            );

          }


          pendingCandidates
            .get(viewerId)
            .push(
              message.candidate
            );


          return;
        }


        /*
          Wait until remote description.
        */

        if (
          !pc.remoteDescription
        ) {

          if (
            !pendingCandidates.has(
              viewerId
            )
          ) {

            pendingCandidates.set(
              viewerId,
              []
            );

          }


          pendingCandidates
            .get(viewerId)
            .push(
              message.candidate
            );


          return;
        }


        try {

          await pc.addIceCandidate(
            new RTCIceCandidate(
              message.candidate
            )
          );

        } catch (error) {

          console.log(
            "ICE error:",
            error
          );

        }


        return;
      }

    };


  /* =======================================
     CLOSE
  ======================================= */

  socket.onclose =
    () => {

      if (
        ws === socket
      ) {

        ws = null;

      }


      roleReceived =
        false;


      closeAllPeers();


      if (
        !pageUnloading &&
        !intentionallyClosed
      ) {

        status.textContent =
          "Reconnecting...";


        clearTimeout(
          reconnectTimer
        );


        reconnectAttempt++;


        const delay =
          Math.min(
            1000 *
            Math.pow(
              2,
              reconnectAttempt - 1
            ),
            10000
          );


        reconnectTimer =
          setTimeout(
            connectWebSocket,
            delay
          );

      }

    };


  /* =======================================
     ERROR
  ======================================= */

  socket.onerror =
    error => {

      console.error(
        "WebSocket error:",
        error
      );

    };

}


/* =========================================
   START
========================================= */

connectWebSocket();


/* =========================================
   PAGE CLOSE
========================================= */

window.addEventListener(
  "beforeunload",
  () => {

    pageUnloading =
      true;

    intentionallyClosed =
      true;


    clearTimeout(
      reconnectTimer
    );


    closeAllPeers();


    if (stream) {

      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );

      stream = null;

    }


    if (ws) {

      try {
        ws.close();
      } catch (error) {}

    }

  }
);
