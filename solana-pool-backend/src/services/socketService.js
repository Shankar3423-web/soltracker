'use strict';
const { Server } = require('socket.io');

let _io = null;

function initSocket(httpServer) {
    if (_io) return _io;

    _io = new Server(httpServer, {
        cors: {
            origin: "*", // Adjust for production
            methods: ["GET", "POST"]
        }
    });

    _io.on('connection', (socket) => {
        console.log(`[Socket] New connection: ${socket.id}`);

        // Join room based on pool address for targeted updates
        socket.on('subscribe', (poolAddress) => {
            if (poolAddress) {
                socket.join(poolAddress);
                console.log(`[Socket] Client ${socket.id} subscribed to pool: ${poolAddress}`);
            }
        });

        socket.on('unsubscribe', (poolAddress) => {
            if (poolAddress) {
                socket.leave(poolAddress);
                console.log(`[Socket] Client ${socket.id} unsubscribed from: ${poolAddress}`);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] Connection closed: ${socket.id}`);
        });
    });

    return _io;
}

function getIO() {
    return _io;
}

/**
 * Broadcast candle update to all clients in a specifically focused pool room.
 */
function broadcastCandleUpdate(poolAddress, candle) {
    if (_io) {
        _io.to(poolAddress).emit('candle_update', candle);
    }
}

/**
 * Broadcast new swap transaction to the specific pool room.
 */
function broadcastNewSwap(poolAddress, swap) {
    if (_io) {
        _io.to(poolAddress).emit('new_swap', swap);
    }
}

module.exports = {
    initSocket,
    getIO,
    broadcastCandleUpdate,
    broadcastNewSwap
};
