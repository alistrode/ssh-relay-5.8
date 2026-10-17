'use strict';
const net = require('node:net');
const loopback = host => ['127.0.0.1','localhost','::1'].includes(host);
function attachForwarding(client) {
  const listeners=new Map(), sockets=new Set();
  const track=s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>s.destroy());return s;};
  client.on('tcpip',(accept,reject,info)=>{
    if(!loopback(info.destIP)||!Number.isInteger(info.destPort)||info.destPort<1||info.destPort>65535)return reject();
    const socket=track(net.connect({host:info.destIP,port:info.destPort}));
    const timer=setTimeout(()=>socket.destroy(),10000);
    socket.once('connect',()=>{clearTimeout(timer);const channel=accept();track(channel);socket.pipe(channel).pipe(socket);channel.on('close',()=>socket.destroy());socket.on('close',()=>channel.destroy());});
    socket.once('error',()=>{clearTimeout(timer);reject();});
  });
  client.on('request',(accept,reject,name,info)=>{
    if(!['tcpip-forward','cancel-tcpip-forward'].includes(name))return reject?.();
    if(!loopback(info.bindAddr)||!Number.isInteger(info.bindPort)||info.bindPort<0||info.bindPort>65535)return reject?.();
    const key=info.bindAddr+':'+info.bindPort;
    if(name==='cancel-tcpip-forward'){const server=listeners.get(key);if(!server)return reject?.();listeners.delete(key);server.close();return accept?.();}
    if(listeners.size>=8||listeners.has(key))return reject?.();
    const server=net.createServer(socket=>{
      track(socket);const port=server.address().port;
      client.forwardOut(info.bindAddr,port,socket.remoteAddress||'127.0.0.1',socket.remotePort||0,(error,channel)=>{
        if(error)return socket.destroy();track(channel);socket.pipe(channel).pipe(socket);channel.on('close',()=>socket.destroy());socket.on('close',()=>channel.destroy());
      });
    });
    let started=false;
    server.on('error',()=>{if(!started)reject?.();});
    server.listen(info.bindPort,info.bindAddr,()=>{started=true;listeners.set(info.bindAddr+':'+server.address().port,server);accept?.(server.address().port);});
  });
  client.on('close',()=>{for(const s of listeners.values())s.close();for(const s of sockets)s.destroy();listeners.clear();sockets.clear();});
}
module.exports={attachForwarding};
