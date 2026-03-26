const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const SECRET = process.env.JWT_SECRET;

// DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// REGISTER
app.post('/register', async (req, res) => {
  const { login, password } = req.body;

  if (!login || login.length < 3 || login.length > 16) {
    return res.status(400).json({ error: 'Invalid login' });
  }

  if (!password || password.length < 10 || password.length > 16) {
    return res.status(400).json({ error: 'Invalid password' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
        'INSERT INTO users (login, password_hash) VALUES ($1, $2) RETURNING id',
        [login, hash]
    );

    res.json({ id: result.rows[0].id });

  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ error: 'Login already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  const { login, password } = req.body;

  const result = await pool.query(
      'SELECT * FROM users WHERE login = $1',
      [login]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = result.rows[0];

  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '1h' });

  res.json({ token });
});

// SOCKET AUTH MIDDLEWARE
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const payload = jwt.verify(token, SECRET);
    socket.userId = payload.userId;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

//WEBRTC LOGIC
io.on('connection', (socket) => {
  console.log('User connected:', socket.userId);

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

    socket.emit('joined', {
      isInitiator,
      peerId: rooms[roomId].find(id => id !== socket.id)
    });

    if (isInitiator) {
      socket.to(roomId).emit('peer-joined');
    }
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

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});