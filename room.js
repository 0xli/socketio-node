var app = require('express')();
var http = require('http').Server(app);
//var io = require('socket.io')(http);
var options = {
    // key: fs.readFileSync('cert/key.pem'),
    // cert: fs.readFileSync('cert/cert.pem')
    key: fs.readFileSync('/usr/local/nginx/certificates/callt.net/callt.net.key'),
    cert: fs.readFileSync('/usr/local/nginx/certificates/callt.net/fullchain.cer')
};

const https = require('https');
const server = https.createServer(options, app);
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
var io;
if (options.cert)
    io = require('socket.io')(server,{
        maxHttpBufferSize: 1e8
    });
else
    io = require('socket.io')(http,{
        maxHttpBufferSize: 1e8
    });


app.get('/', function(req, res){
    res.sendFile(__dirname +'/room.html');
});
var roomno = 1;
io.on('connection', function(socket){
    socket.on('new-channel', function (room) {
        if (room==null || room.channel==null || room.sender==null){
            console.log("new-channel parameter missed");
        }
        socket.join(room.channel);
        console.log(room.sender+" join room channel:"+room.channel);
        //Send this event to everyone in the room.
        io.sockets.in(room.channel).emit('connectToRoom', room);
    });
    socket.on('disconnect', function (channel) {
        socket.leave();
    });
    socket.on('message', function (data) {
        console.log(" got message:"+data.data+" from "+ data.sender)
        socket.broadcast.emit('message', data);
    });
})

// run app
let port = 3000;
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


