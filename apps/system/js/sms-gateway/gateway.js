window.addEventListener('ready', ev => {
    var config = ev.detail,
        wifiManager = navigator.mozWifiManager,
        lastVoiceConnected, httpServer, lastIp;

    var lengthInUtf8Bytes = function(str) {
        // Matches only the 10.. bytes that are non-initial characters in a multi-byte sequence.
        var m = encodeURIComponent(str).match(/%[89ABab]/g);
        return str.length + (m ? m.length : 0);
    };

    // Get reference to the connection of SIM #1
    var conn = navigator.mozMobileConnections[0];

    // We can send messages when connection status changes
    conn.addEventListener('voicechange', function vc() {

        if (lastVoiceConnected === conn.voice.connected) {
            return;
        }
        lastVoiceConnected = conn.voice.connected;

        writeLine('Telephony status changed: ' + (conn.voice.connected ? 'connected' : 'disconnected'));

        // If we are connected to the phone network
        if (conn.voice.connected) {

            // Remove the event listener, so we don't send the SMS multiple times
            conn.removeEventListener('voicechange', vc);

            // Wait for WiFi connection to come up
            if ('onconnectioninfoupdate' in wifiManager) {
                wifiManager.onconnectioninfoupdate = function(e) {
                    if (e.ipAddress && lastIp !== e.ipAddress) {

                        // If there's already a HTTP server instance running, stop it now
                        if (httpServer) {
                            console.log('Stopping HTTP Server ...');
                            httpServer.stop();
                        }

                        writeLine('Starting HTTP Server ...');

                        // Start a new HTTP server
                        httpServer = new HTTPServer(80);

                        httpServer.addEventListener('request', function(evt) {
                            var request = evt.request,
                                response = evt.response,
                                date = new Date().toUTCString(),
                                body = '';

                            // default to JSON
                            response.headers['Content-Type'] = 'application/json; charset=utf-8';
                            response.headers['Access-Control-Allow-Origin'] = '*';
                            response.headers['Last-Modified'] = date;
                            response.headers['Pragma'] = 'public';
                            response.headers['Cache-Control'] = 'public, max-age=0';
                            response.headers['Expires'] = date;

                            var body;

                            switch (request.path) {

                                // We got a request to send a SMS
                                case '/send':
                                    var number = request.params.number;
                                    var message = request.params.message;

                                    writeLine('Try to send SMS...');

                                    var sendReq = navigator.mozMobileMessage.send(number, message);
                                    sendReq.onsuccess = function() {
                                        writeLine('Message sent successfully');

                                        body = '{"message":"Message sent successfully"}';
                                        response.headers['Content-Length'] = lengthInUtf8Bytes(body);
                                        response.send(body);
                                    };
                                    sendReq.onerror = function() {
                                        writeLine('Could not send SMS: ' + sendReq.error);

                                        body = '{"message":"Could not send SMS: ' + sendReq.error + '"}';
                                        response.headers['Content-Length'] = lengthInUtf8Bytes(body);
                                        response.send(body);
                                    };

                                    break;

                                    // Default error message
                                    // TODO: better handling for invalid requests with more clear exception messages
                                default:
                                    body = '{"message":"Please use /send with GET parameters"}';
                                    response.headers['Content-Length'] = lengthInUtf8Bytes(body);
                                    response.send(body);
                            }
                        });

                        httpServer.start();

                        writeLine('HTTP Server running at: http://' + e.ipAddress + ':' + httpServer.port + '/');

                        writeLine('SMS gateway ready');
                    }

                    lastIp = e.ipAddress;
                };
            }
        } else {
            if (httpServer) {
                console.log('Stopping HTTP Server ...');
                httpServer.stop();
                httpServer = null;
            }
        }
    });
});
