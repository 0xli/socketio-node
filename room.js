var app = require('express')();
var http = require('http').Server(app);
//var io = require('socket.io')(http);
var fs = require('fs');
var options = {
    // key: fs.readFileSync('cert/key.pem'),
    // cert: fs.readFileSync('cert/cert.pem')
    // key: fs.readFileSync('/usr/local/nginx/certificates/callt.net/callt.net.key'),
    // cert: fs.readFileSync('/usr/local/nginx/certificates/callt.net/fullchain.cer')
    // key: fs.readFileSync('/root/.acme.sh/allcomchina.com/allcomchina.com.key'),
    // cert: fs.readFileSync('/root/.acme.sh/allcomchina.com/fullchain.cer')
};

const https = require('https');
const server = https.createServer(options, app);
require("events").captureRejections = true;

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
const { Server } = require("socket.io");
var io;
if (options.cert)
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["kademlia-header"],
            credentials: true
        },
        maxHttpBufferSize: 1e8
    });
else
    io = new Server(http, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["kademlia-header"],
            credentials: true
        },
        maxHttpBufferSize: 1e8
    });


app.get('/', function(req, res){
    res.sendFile(__dirname +'/room.html');
});
var roomno = 1;
io.on('connection', function(socket){
    socket[Symbol.for('nodejs.rejection')] = (err) => {
        socket.emit("error", err);
    };
    var address = socket.handshake.address;
    console.log('New connection from ' + address);
    socket.on('new-channel', function (room) {
        if (room==null || room.channel==null || room.sender==null){
            console.log(address+"->"+"new-channel parameter missed");
        }
        socket.join(room.channel);
        console.log(address+"->"+room.sender+" join room channel:"+room.channel);
        //Send this event to everyone in the room.
        io.sockets.in(room.channel).emit('connectToRoom', room);
        socket.on('disconnect', function (reason) {
            console.log(address+"->"+room.sender+" leave channel:"+room.channel+":"+reason);
            socket.leave(room.channel);
            io.sockets.in(room.channel).emit('disconnectToRoom', room);
            socket.disconnect(true);
            console.log(address+"->"+room.sender+" left channel:"+room.channel);
        });
        socket.on('message', function (data) {
            console.log(address+"->"+" got message:"+data.data+" from "+ data.sender)
            // sending to all clients in 'game' room(channel) except sender
            socket.broadcast.to(room.channel).emit('message', data);
            // sending to all clients except sender
            //        socket.broadcast.emit('message', data);
            // sending to all clients in 'game' room(channel), include sender
            // io.sockets.in(room.channel).emit('message', data);
        });
        socket.on('error', (error) => {
            console.log(address+": error:"+JSON.stringify(error));
        });
        socket.on('disconnecting', (reason) => {
            console.log(address+": disconnecting:"+JSON.stringify(reason));
        });
    });
})

// run app
let port = 3003;
let tlsPort = 3002;

// http.listen(3000, function(){
//     console.log('listening on localhost:3000');
// });

if (options.cert){
    server.listen(tlsPort);
    console.log(`https started and listenting on port ${tlsPort}`);
}
else {
    console.log(`started and listenting on port ${port}`);
    http.listen(port, function(){
        console.log('http listening on *: ${port}');
    });
}

process.on('unhandledRejection', (reason, promise) => {
    process.exit(1);
});


