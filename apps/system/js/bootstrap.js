/**
 * bootstrap.js
 *
 * This file does a number of things:
 *
 * 1. It preps the frontend, registers itself with Gecko, turns on the screen,
 *    sets some initial settings, etc. At the end it will emit a ready event,
 *    and your own code can run. See the examples/ folder.
 * 2. Manage WiFi connections for you based on local_settings.json file.
 *    If you want to do this yourself, remove the section.
 * 3. Manage cellular connections for you based on same file.
 *    Also if you want to manage that yourself, remove the section.
 * 4. Add autogrant, because you cannot grant permissions w/o display
 */
function writeLine(str) {
    console.log(str);
    document.getElementById('console').textContent += str + "\n";
};

new Promise(res => {
    // Wait until the page is loaded
    document.readyState === 'complete' ? res() : window.onload = res;
}).then(() => {
    // Register ourselfs with Gecko
    var evt = new CustomEvent('mozContentEvent', {
        bubbles: true,
        cancelable: false,
        detail: {
            type: 'system-message-listener-ready'
        }
    });
    window.dispatchEvent(evt);

    // Listen for wakelock events
    window.cpuManager = new CpuManager();
    window.cpuManager.start();

    // Disable cpuSleepAllowed, need to be explicitely run by user
    navigator.mozPower.cpuSleepAllowed = false;
}).then(() => {
    // Turn the screen on

    // No clue why this is needed but it works.
    navigator.mozPower.screenBrightness = 0.9;

    return new Promise((res, rej) => {
        setTimeout(function() {
            navigator.mozPower.screenEnabled = true;
            navigator.mozPower.screenBrightness = 1;
            res();
        }, 100);
    });
}).then(() => {
    // Initial settings
    return new Promise((res, rej) => {
        var req = navigator.mozSettings.createLock().set({
            'ril.data.enabled': false,
            'ftu.ril.data.enabled': false,
            'ril.data.roaming_enabled': false,
            'wifi.enabled': false,
            'debugger.remote-mode': 'adb-devtools',
            'devtools.debugger.remote-enabled': true, // pre-1.4
            'app.reportCrashes': 'always',
            'ril.sms.defaultServiceId': 0,
            'ril.sms.enabled': true
        });
        req.onsuccess = res;
        req.onerror = rej;
    });
}).then(() => {
    console.log('Successfully wrote general settings');

    return new Promise((res, rej) => {

        // Fetching settings.json
        var volumes = navigator.getDeviceStorages('sdcard');

        if (volumes.length === 0) {
            writeLine('No SD card found to load settings from!');
        } else {
            if (volumes.length === 1) {
                writeLine('There is 1 SD card available');
            } else {
                writeLine('There are ' + volumes.length + ' SD cards available');
            }

            for (var i = 0; i < volumes.length; ++i) {
                var sdcard = volumes[i];

                writeLine('Try to load settings file from SD card "' + sdcard.storageName + '"');

                var availableRequest = sdcard.available();

                availableRequest.onsuccess = function(sdcard) {
                    writeLine('SD card "' + sdcard.storageName + '" status: ' + availableRequest.result);
                }.bind(availableRequest, sdcard);

                availableRequest.onerror = function(sdcard) {
                    writeLine('Error while determining SD card "' + sdcard.storageName + '" status', availableRequest.error.name);
                }.bind(availableRequest, sdcard);

                var request = sdcard.get('settings.json');

                request.onsuccess = function(sdcard) {
                    var file = request.result;
                    writeLine('Load settings file "' + file.name + '"');

                    var freader = new FileReader();
                    freader.onload = function(sdcard, e) {

                        writeLine('Successfully loaded settings file from SD card "' + sdcard.storageName + '"');

                        res(JSON.parse(e.target.result));

                    }.bind(freader, sdcard);
                    freader.readAsText(file);

                    // Once we found a file we check if there is other results
                    if (!request.done) {
                        // Then we move to the next result, which call the cursor
                        // success with the next file as result.
                        request.continue();
                    }
                }.bind(request, sdcard);

                request.onerror = function(sdcard) {
                    //TODO: Better error handling
                    if (request.error === null) {
                        writeLine('Unable to load the settings file from SD card "' + sdcard.storageName + '"');
                    }
                }.bind(request, sdcard);
            }
        }
    });

}).then(localSettings => {
    writeLine('Ready');

    window.addEventListener('online', () => {
        writeLine('Ready & connected');
    });
    window.addEventListener('offline', () => {
        writeLine('Ready (no connection)');
    });

    startRadio(localSettings.cellular);
    startWifi(localSettings.wifi);
    startAutogrant();

    window.dispatchEvent(new CustomEvent('ready', {
        detail: localSettings
    }));
}).catch(err => {
    navigator.vibrate(200);

    writeLine('Booting failed: ' + err);
});

/**
 * Radio
 */
function startRadio(options) {
    options = options || {
        edgeOnly: false,
        roaming: false
    };

    var needsPinButNoPinRequired = false;

    window.unlockSim = function(pin, alsoRemoveSimLock) {
        options.pin = pin;
        needsPinButNoPinRequired = false;

        var icc = navigator.mozIccManager.getIccById(
            navigator.mozIccManager.iccIds[0]);

        unlockPinIfNeeded(icc, function() {
            var r2 = icc.setCardLock({
                lockType: 'pin',
                pin: pin,
                enabled: false
            });
            r2.onsuccess = function() {
                writeLine('removed pin');
            };
            r2.onerror = function(err) {
                writeLine('remove pin failed: ' + err);
            };
        });
    };

    function unlockPinIfNeeded(icc, cb) {
        if (!icc) {
            return;
        }
        if (needsPinButNoPinRequired) {
            return;
        }
        if (icc.cardState !== 'ready') {
            writeLine('SIM Card state: ' + icc.cardState + ', ' + icc.iccInfo.iccid);
        }
        if (icc.cardState === 'pinRequired') {
            if (!options.pin) {
                needsPinButNoPinRequired = true;
                return writeLine('SIM needs PIN but no PIN supplied');
            }
            var req = icc.unlockCardLock({
                lockType: 'pin',
                pin: options.pin
            });
            req.onsuccess = cb;
            req.onerror = function(err) {
                writeLine('Could not unlock SIM: ' + err);
            };
        }
    }

    function enableRadio() {
        var networkType = options.edgeOnly ? ['gsm'] : ['wcdma/gsm-auto'];

        // For every SIM card enable radio
        [].forEach.call(navigator.mozMobileConnections, function(conn) {
            conn.setPreferredNetworkType(networkType[0]);

            conn.onradiostatechange = function() {
                writeLine('Radio state changed: ' + conn.radioState);

                if (needsPinButNoPinRequired === true) {
                    return;
                }

                if (conn.radioState === 'enabled') {
                    // @todo multisim bug
                    unlockPinIfNeeded(navigator.mozIccManager.getIccById(navigator.mozIccManager.iccIds[0]));

                    setTimeout(() => {
                        unlockPinIfNeeded(navigator.mozIccManager.getIccById(navigator.mozIccManager.iccIds[0]));
                    }, 5000);
                }
            };

            function rsc() {
                // Sometimes radioState is enabled here,
                // and thats wrong so we should do this again after that
                if (conn.radioState === 'disabled') {
                    conn.removeEventListener('radiostatechange', rsc);
                }

                // todo: when status is 'enabling' we shouldnt call this I think
                // doesnt cause much harm though.
                var sre = conn.setRadioEnabled(true);
                sre.onerror = function(err) {
                    writeLine('Failed to enable radio for: ' + conn + ', ' + err);
                };
            }

            if (conn.radioState === 'disabled') {
                rsc();
            } else {
                conn.addEventListener('radiostatechange', rsc);
            }
        });

        navigator.mozSettings.createLock().set({
            'ril.radio.preferredNetworkType': networkType
        });
    }

    function enable() {
        var r = navigator.mozSettings.createLock().set({
            'ril.radio.disabled': false
        });

        r.onsuccess = () => enableRadio();
        r.onerror = err => writeLine('error');
    }

    function disable() {
        var r = navigator.mozSettings.createLock().set({
            'ril.radio.disabled': true
        });

        r.onsuccess = r.onerror = () => {
            [].forEach.call(navigator.mozMobileConnections, function(conn) {
                conn.setRadioEnabled(false);
            });
        };
    }

    // Todo: find whether this actually works still...
    navigator.mozIccManager.oniccdetected = function(e) {
        var icc = navigator.mozIccManager.getIccById(e.iccId);
        unlockPinIfNeeded(icc);
        icc.oncardstatechange = () => unlockPinIfNeeded(icc);
        enableOperatorVariantHandler(e.iccId, 0); // <- multi sim bug would this be

        // weird stuff going on here, have to re-retrieve the icc because cardState
        // sometimes doesnt get updated...
        setTimeout(() => unlockPinIfNeeded(navigator.mozIccManager.getIccById(e.iccId)), 5000);
        setTimeout(() => unlockPinIfNeeded(navigator.mozIccManager.getIccById(e.iccId)), 10000);
        setTimeout(() => unlockPinIfNeeded(navigator.mozIccManager.getIccById(e.iccId)), 20000);
    };

    navigator.mozIccManager.iccIds.forEach((iccId, ix) => {
        enableOperatorVariantHandler(iccId, ix);
    });

    function enableOperatorVariantHandler(id, ix) {
        var iccManager = window.iccManager = navigator.mozIccManager;

        var ovh = window['ovh' + ix] = new OperatorVariantHandler(id, ix);
        ovh.init();

        setTimeout(function() {
            writeLine('enabling data');

            navigator.mozSettings.createLock().set({
                'ril.data.enabled': true,
                'ftu.ril.data.enabled': true,
                'ril.data.roaming_enabled': options.roaming
            });

            var icc = iccManager.getIccById(id);
            ovh.applySettings(icc.iccInfo.mcc, icc.iccInfo.mnc, true);

        }, 3000);

        var conn = navigator.mozMobileConnections[ix];
        var lastState = conn.data.connected;

        conn.addEventListener('datachange', function(e) {
            if (conn.data.connected === lastState) {
                return;
            }

            if (conn.data.connected) {
                writeLine('Has connection over cellular network');
            } else {
                writeLine('Lost connection over cellular network');
            }

            lastState = conn.data.connected;
        });
    }

    enableRadio();

    // Done
    window.enableRadio = enable;
    window.disableRadio = disable;
}

/**
 * WiFi
 */
function startWifi(options) {
    options = options || {
        enabled: false
    };

    if (options.enabled && !options.network) {
        return writeLine('WiFi network required');
    } else if (options.enabled) {
        setTimeout(() => {
            enableWifi();
        });
    }

    var wifiManager = navigator.mozWifiManager;

    var lastIp = null;
    var lastWifiStatus = null;

    // So what happens:
    // 1. Set wifi.enabled -> true
    // 2. wifiManager.onenabled fires, and calls doConnect
    // 3. doConnect calls connectToWifi (which returns promise)
    // 4. connectToWifi starts by trying to associate with the network
    // 5. If that succeeds wifiManager.onstatuschange will at one point have
    //    connected. If so resolve promise.
    // 6. If onstatuschange goes to disconnect, reject the promise

    // We need to have some wrappers around wifi connections in place
    function enableWifi(network, password) {
        if (network) options.network = network;
        if (password) options.password = password;

        options.enabled = true;
        navigator.mozSettings.createLock().set({
            'wifi.enabled': true
        });
    }

    function doConnect() {
        connectToWifi(options.network, options.password)
            .then(() => {
                writeLine('Wifi connection succeeded');
            })
            .catch(err => {
                writeLine('Wifi connection failed: ' + err);
            });
    }

    function disableWifi() {
        options.enabled = false;
        navigator.mozSettings.createLock().set({
            'wifi.enabled': false
        });
    }

    wifiManager.onenabled = function() {
        setTimeout(function() {
            doConnect();
        }, 1000);
    };
    wifiManager.ondisabled = function() {
        writeLine('Wifi was disabled');
    };

    if ('onconnectioninfoupdate' in wifiManager) {
        wifiManager.onconnectioninfoupdate = function(e) {
            if (e.ipAddress && lastIp !== e.ipAddress) {
                writeLine('Wifi now has IP: ' + e.ipAddress);
            }
            lastIp = e.ipAddress;
        };
    }

    // Fucking FFOS 1.3 doesnt support addEventListener on wifiManager.
    function restoreStatusChangeEvent() {
        wifiManager.onstatuschange = function(e) {
            if (e.status !== lastWifiStatus) {
                if (e.status === 'connected') {
                    writeLine('Wifi is now connected to: ' + options.network);
                } else {
                    writeLine('Wifi status changed: ' + e.status);
                }
                lastWifiStatus = e.status;
            }
        };
    }
    restoreStatusChangeEvent();

    // Connect to Wifi
    function connectToWifi(network, pass) {
        return new Promise((res, rej) => {
            if (!options.enabled) {
                rej('Wifi is not enabled in config');
                return disableWifi();
            }

            // set up a bunch of event listeners
            wifiManager.onstatuschange = function(e) {
                switch (e.status) {
                    case 'connected':
                        res();
                        break;
                    case 'disconnected':
                        rej('Could not connect to network');
                        break;
                    default:
                        return;
                }
                restoreStatusChangeEvent();
            };

            writeLine('Attempting to connect to: ' + network);

            var n = wifiManager.getNetworks();
            n.onsuccess = function() {
                var wifi = n.result.filter(w => w.ssid === network)[0];
                if (!wifi) {
                    return rej('Could not find wifi network "' + network + '"');
                }

                if (handleSecurity(wifi, pass) === false) {
                    return rej('No support for ' + wifi.security[0]);
                }

                var req = wifiManager.associate(wifi);
                req.onsuccess = () => writeLine('Associated: ' + options.network);
                req.onerror = () => {
                    // Hmm, this shouldn't really matter either apparently
                    writeLine('Associating failed: ' + req.error);
                };
            };
            // For some reason this doesn't matter... Hmm...
            n.onerror = e => console.log('GetNetworks failed: ' + JSON.stringify(e));
        });
    }

    function handleSecurity(network, pass) {
        if (network.security.length === 0) {
            // no pass
        } else if (network.security[0] === 'WPA-PSK') {
            network.keyManagement = 'WPA-PSK';
            network.psk = pass;
        } else {
            return false;
        }
    }

    window.enableWifi = enableWifi;
    window.disableWifi = disableWifi;
}

/**
 * Autogrant
 * Because there will be no UI to grant permissions
 */
function startAutogrant() {
    // Autogrant permissions
    window.addEventListener('mozChromeEvent', function(evt) {
        var detail = evt.detail;
        switch (detail.type) {
            case 'permission-prompt':
                writeLine('Autogrant permissions for: ' + detail.permissions);

                var ev2 = document.createEvent('CustomEvent');
                ev2.initCustomEvent('mozContentEvent', true, true, {
                    id: detail.id,
                    type: 'permission-allow',
                    remember: true
                });
                window.dispatchEvent(ev2);
                break;

            case 'remote-debugger-prompt':
                dump('REMOTE DEBUGGER PROMPT!!!\n');
                break;
        }
    });
}
