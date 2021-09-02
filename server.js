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
var channels = {};

io.sockets.on('connection', function (socket) {
    var initiatorChannel = '';
    if (!io.isConnected) {
        io.isConnected = true;
    }

    socket.on('new-channel', function (data) {
        if (!channels[data.channel]) {
            initiatorChannel = data.channel;
            onNewNamespace(data.channel, data.sender);
        }

        console.log('new-channel: '+data.channel)
        channels[data.channel] = data.channel;
//        onNewNamespace(data.channel, data.sender);
    });

    socket.on('presence', function (channel) {
        var isChannelPresent = !! channels[channel];
        socket.emit('presence', isChannelPresent);
    });

    socket.on('disconnect', function (channel) {
        if (initiatorChannel) {
            delete channels[initiatorChannel];
        }
    });
});

io.of("/").adapter.on("create-room", (room) => {
    console.log(`room ${room} was created`);
});

io.of("/").adapter.on("join-room", (room, id) => {
    console.log(`socket ${id} has joined room ${room}`);
});
io.of("/").adapter.on("message", (room, id) => {
    console.log(`socket ${id} has joined room ${room}`);
});
function onNewNamespace(channel, sender) {
    io.of("/"+channel).adapter.on("create-room", (room) => {
        console.log(`${channel}:${sender}:$$$room ${room} was created`);
    });

    io.of("/"+channel).adapter.on("join-room", (room, id) => {
        console.log(`${channel}:${sender}:$$$socket ${id} has joined room ${room}`);
    });
    io.of("/"+channel).adapter.on("message", (room, id) => {
        console.log(`${channel}:${sender}:$$$socket ${id} has got message ${room}`);
    });
    io.of('/' + channel).on('connection', function (socket) {
        var username;
        if (io.isConnected) {
            io.isConnected = false;
//            socket.emit('connect', true);
        }

        socket.on('message', function (data) {
            console.log(sender+" got message:"+data.data+" from "+ data.sender)
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
