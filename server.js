const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    console.log('유저 접속:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);
        if (!rooms[roomCode]) rooms[roomCode] = { players: {}, clouds: {} };
        
        // 플레이어 초기화
        rooms[roomCode].players[socket.id] = { x: 0, y: 5, z: 0, rotation: 0 };
        
        socket.emit('roomJoined', roomCode);
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('playerMove', (data) => {
        const { roomCode, position, rotation } = data;
        if (rooms[roomCode] && rooms[roomCode].players[socket.id]) {
            rooms[roomCode].players[socket.id] = { ...position, rotation };
            socket.to(roomCode).emit('playerMoved', { id: socket.id, position, rotation });
        }
    });

    socket.on('cloudStepped', (data) => {
        const { roomCode, cloudId } = data;
        // 다른 플레이어들에게 발판 상태 변경 동기화
        socket.to(roomCode).emit('cloudStateChanged', { cloudId, state: 'pressed' });
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            if (rooms[roomCode].players[socket.id]) {
                delete rooms[roomCode].players[socket.id];
                io.to(roomCode).emit('playerDisconnected', socket.id);
            }
        }
    });
});

server.listen(3000, () => {
    console.log('포실팡 서버가 http://localhost:3000 에서 실행 중입니다.');
});