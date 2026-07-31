// https://www.webrtc-experiment.com/

var fs = require('fs');

// don't forget to use your own keys!
var options = {
    // key: fs.readFileSync('cert/key.pem'),
    // cert: fs.readFileSync('cert/cert.pem')
    // key: fs.readFileSync('/usr/local/nginx/certificates/callt.net/callt.net.key'),
    // cert: fs.readFileSync('/usr/local/nginx/certificates/callt.net/fullchain.cer')
    //ssl_certificate /usr/local/nginx/certificates/callt.net/fullchain.cer;
    //ssl_certificate_key /usr/local/nginx/certificates/callt.net/callt.net.key;
    // key: fs.readFileSync('/etc/letsencrypt/live/webrtcweb.com/privkey.pem'),
    // cert: fs.readFileSync('/etc/letsencrypt/live/webrtcweb.com/fullchain.pem')
};

// HTTPs server
// var app = require('https').createServer(options, function(request, response) {
//     response.writeHead(200, {
//         'Content-Type': 'text/html',
//         'Access-Control-Allow-Origin': '*',
//         'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
//     });
//     var link = 'https://github.com/muaz-khan/WebRTC-Experiment/tree/master/socketio-over-nodejs';
//     response.write('<title>socketio-over-nodejs</title><h1><a href="'+ link + '">socketio-over-nodejs</a></h1><pre>var socket = io.connect("https://webrtcweb.com:9559/");</pre>');
//     response.end();
// });

var app = require('express')();
var http = require('http').Server(app);
const https = require('https');
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.header('Access-Control-Allow-Headers', 'origin, content-type');
    if (req.method === 'OPTIONS') {
        res.send(200);
    } else {
        next();
    }
});

app.get('/ui', function(req, res){
    res.sendFile(__dirname + '/index.html');
});
// app.get('/socket.io/socket.io.js', function(req, res){
//     res.sendFile(__dirname + '/node_modules/socket.io-client/dist/socket.io.js');
// });

// socket.io goes below
var io = require('socket.io')(http,{
    maxHttpBufferSize: 1e8
});

// var io = require('socket.io').listen(app, {
//     log: true,
//     cors: true,
//     origins: '*:*'
// });

// io.set('transports', [
//     // 'websocket',
//     'xhr-polling',
//     'jsonp-polling'
// ]);
//
// Which channels currently have someone in them. Answers `presence`.
var channels = {};

// Which channels already have handlers wired onto them. Separate from
// `channels`, and never cleared.
//
// io.of(name) creates a Socket.IO namespace that lives for the life of the
// process — there is no API to remove one. Tracking only `channels`, deleting
// the entry on disconnect, and re-running onNewNamespace when the channel came
// back meant the namespace was still there and got ANOTHER set of handlers
// each round. A single event then fans out to N duplicates, each of which also
// logs. Measured: 8 reconnects of one channel left 8 connection listeners.
//
// The namespace cannot be reclaimed, so wiring is made idempotent instead.
var wired = new Set();

// Room bookkeeping and per-message logs are chatty and say nothing an operator
// acts on. DEBUG_ROOMS=1 brings them back.
var debugRooms = process.env.DEBUG_ROOMS === '1';

io.sockets.on('connection', function (socket) {
    var initiatorChannel = '';

    socket.on('new-channel', function (data) {
        if (!wired.has(data.channel)) {
            wired.add(data.channel);
            onNewNamespace(data.channel, data.sender);
        }
        if (!channels[data.channel]) {
            initiatorChannel = data.channel;
        }
        if (debugRooms) console.log('new-channel: ' + data.channel);
        channels[data.channel] = data.channel;
    });

    socket.on('presence', function (channel) {
        var isChannelPresent = !! channels[channel];
        socket.emit('presence', isChannelPresent);
    });

    socket.on('disconnect', function (channel) {
        // Only presence goes. `wired` must survive, or the next client on this
        // channel re-registers every handler again.
        if (initiatorChannel) {
            delete channels[initiatorChannel];
        }
    });
});

if (debugRooms) {
    io.of("/").adapter.on("create-room", (room) => {
        console.log(`room ${room} was created`);
    });
    io.of("/").adapter.on("join-room", (room, id) => {
        console.log(`socket ${id} has joined room ${room}`);
    });
}

function onNewNamespace(channel, sender) {
    if (debugRooms) {
        io.of("/"+channel).adapter.on("create-room", (room) => {
            console.log(`${channel}:${sender}:$$$room ${room} was created`);
        });
        io.of("/"+channel).adapter.on("join-room", (room, id) => {
            console.log(`${channel}:${sender}:$$$socket ${id} has joined room ${room}`);
        });
    }
    io.of('/' + channel).on('connection', function (socket) {
        var username;

        socket.on('message', function (data) {
            // Size, never the payload: these carry WebRTC SDP and ICE, and
            // maxHttpBufferSize allows 100MB. The old log was a string concat
            // plus a synchronous stdout write per signalling message, on the
            // hot path, multiplied by every duplicate handler above.
            if (debugRooms) {
                var size = data && data.data ? String(data.data).length : 0;
                console.log(`${sender} got message from ${data && data.sender} (${size}B)`);
            }
            socket.broadcast.emit('message', data);
            // if (data.sender == sender) {
            //     if(!username) username = data.data.sender;
            //
            //     socket.broadcast.emit('message', data);
            // }
        });

        socket.on('disconnect', function() {
            if(username) {
                socket.broadcast.emit('user-left', username);
                username = null;
            }
        });
    });
}

// run app
let port = 3003;
let tlsPort = 3002;

//app.listen(process.env.PORT || 3002);
console.log(`started and listenting on port ${port}`);
http.listen(port, function(){
    console.log('listening on *: ${port}');
});
process.on('unhandledRejection', (reason, promise) => {
  process.exit(1);
});

console.log('Please open SSL URL: https://0.0.0.0:'+(process.env.PORT || 3002)+'/');

//app.listen(port);
const server = https.createServer(options, app);
server.listen(tlsPort);
console.log(`started and listenting on port ${tlsPort}`);
