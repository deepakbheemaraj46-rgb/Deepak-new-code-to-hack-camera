const http=require("http");
const fs=require("fs");
const path=require("path");
const WebSocket=require("ws");

const PORT=process.env.PORT||10000;

const server=http.createServer((req,res)=>{
 const routes={"/":"camera.html","/camera":"camera.html","/viewer":"viewer.html"};
 const file=routes[new URL(req.url,"http://x").pathname];
 if(!file){res.writeHead(404);return res.end("Not found");}
 fs.readFile(path.join(__dirname,file),(e,d)=>{
  if(e){res.writeHead(500);return res.end("Error");}
  res.writeHead(200,{"Content-Type":"text/html"});
  res.end(d);
 });
});

const wss=new WebSocket.Server({server});
const cameras=new Map();
const viewers=new Map();
const id=()=>Math.random().toString(36).slice(2,8);

function send(ws,m){
 if(ws.readyState===1)ws.send(JSON.stringify(m));
}

wss.on("connection",(ws,req)=>{
 const p=new URL(req.url,"http://x").pathname;

 if(p==="/camera"){
  const cid=id();
  cameras.set(cid,ws);
  send(ws,{type:"role",cameraId:cid});

  viewers.forEach(v=>send(v,{type:"camera-online",cameraId:cid}));

  ws.on("message",r=>{
   const m=JSON.parse(r);

   if(m.type==="camera-live")
    viewers.forEach((v,vid)=>{
      send(v,{type:"camera-live",cameraId:cid});
      send(ws,{type:"viewer-ready",viewerId:vid});
    });

   if(m.toViewerId&&viewers.has(m.toViewerId))
    send(viewers.get(m.toViewerId),{...m,cameraId:cid});
  });

  ws.on("close",()=>{
   cameras.delete(cid);
   viewers.forEach(v=>send(v,{type:"camera-offline",cameraId:cid}));
  });

  return;
 }

 if(p==="/viewer"){
  const vid=id();
  viewers.set(vid,ws);

  send(ws,{type:"role",viewerId:vid,cameras:[...cameras.keys()]});
  cameras.forEach((c,cid)=>send(ws,{type:"camera-online",cameraId:cid}));

  ws.on("message",r=>{
   const m=JSON.parse(r);

   if(m.type==="viewer-ready"&&cameras.has(m.cameraId))
    send(cameras.get(m.cameraId),{type:"viewer-ready",viewerId:vid});

   if(m.cameraId&&cameras.has(m.cameraId))
    send(cameras.get(m.cameraId),{...m,toViewerId:vid});
  });

  ws.on("close",()=>{
   viewers.delete(vid);
   cameras.forEach(c=>send(c,{type:"viewer-offline",viewerId:vid}));
  });
 }
});

server.listen(PORT,"0.0.0.0",()=>console.log("Server running on",PORT));
