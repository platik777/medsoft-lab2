const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (roomId) => {
    if (!rooms[roomId]) rooms[roomId] = [];

    if (rooms[roomId].length >= 2) {
      socket.emit('room-full');
      return;
    }

    rooms[roomId].push(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;

    const isInitiator = rooms[roomId].length === 2;
    socket.emit('joined', { isInitiator, peerId: rooms[roomId].find(id => id !== socket.id) });

    if (isInitiator) {
      socket.to(roomId).emit('peer-joined');
    }

    console.log(`Room ${roomId}: ${rooms[roomId].length}/2 participants`);
  });

  socket.on('offer', (data) => {
    socket.to(socket.roomId).emit('offer', data);
  });

  socket.on('answer', (data) => {
    socket.to(socket.roomId).emit('answer', data);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(socket.roomId).emit('ice-candidate', data);
  });

  socket.on('end-call', () => {
    socket.to(socket.roomId).emit('call-ended');
    cleanupRoom(socket);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (socket.roomId) {
      socket.to(socket.roomId).emit('call-ended');
      cleanupRoom(socket);
    }
  });

  function cleanupRoom(sock) {
    const room = rooms[sock.roomId];
    if (room) {
      rooms[sock.roomId] = room.filter(id => id !== sock.id);
      if (rooms[sock.roomId].length === 0) {
        delete rooms[sock.roomId];
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
});
