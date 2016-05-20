# HTTP-SMS-Gateway based on Firefox OS

From [wikipedia.org](https://en.wikipedia.org/wiki/SMS_gateway):
> An SMS gateway allows a computer to send or receive Short Message Service (SMS) transmissions to or from a telecommunications network.

This is a fully functional HTTP-SMS-Gateway server that runs on any device supporting Firefox OS.
The device will boot up straight into the server itself, it's not like a app running inside Firefox OS, 
more like a custom operating system that is based on Firefox OS.
After bootup the server provides a REST-ful API through which you are able to send SMS to a provided 
phone number. If the device has a display, it will show a boot-log and some status informations on it.
The server's network connection is configured using a text file on the devices sd-card.

This gateway server was tested using a Firefox OS 2.5 device. But it should also work with newer or older releases.

## How does it work

Firefox OS is based on three parts, Gonk, Gecko and Gaia. Gonk contains the kernel, hardware abstraction layer and 
several other low-level components. Gecko is the application platform layer running all JavaScript and rendering 
stuff. Gaia is the main thing that makes up Firefox OS. This gateway server replaces Gaia and with it's own code.

If the device get's power connection, it will instantly boot up. There's no way to shut it down (except removing 
the power connection **and** the battery). So no one can by mistake shut the server off.

The server will work with wifi or cellular connection. The connection has to be configured by putting a `settings.json` file 
in the root folder of the devices sd-card. The file has to contain a configuration like this:

```json
{
  "wifi": {
    "enabled": true,
    "network": "YOUR_SSID",
    "password": "YOUR_WIFI_PASSWORD"
  },
  "cellular": {
    "roaming": false,
    "edgeOnly": false,
    "pin": "0000"
  }
}
```

## Getting started

1. Get a device running Firefox OS that has cellular connection
3. Clone the Github project to your local computer
4. Connect your device to your computer
4. Run `make reset-gaia` inside the cloned project folder to update the device
5. Put a `settings.json` file on the devices sd-card
6. When all is up and running, you can send messages trought the API using `http://YOUR_PHONES_IP:80/send?number=+49172000000&message=Hello%20World!`

## Known issues

* You can not use a aplha-numeric string as sender identification

## Making changes

The bootup logic that connects to your mobile carrier and wifi rests in [`/apps/system/js/bootstrap.js`](https://github.com/SunboX/fxos-HTTP-SMS-Gateway/blob/master/apps/system/js/bootstrap.js). The main server logic that starts the web server, listens to incomming requests and sends SMS can be found in [`/apps/system/js/sms-gateway/gateway.js`](https://github.com/SunboX/fxos-HTTP-SMS-Gateway/blob/master/apps/system/js/sms-gateway/gateway.js).

## ToDo / Improvements

* Switch the display on and off by pressing the power button

## Thanks

* To Jan Jongboom and it's [JanOS](http://janos.io/). This server's boot-up script is mainly based on the work by Jan
* To Justin D'Arcangelo who build a [embeddable HTTP web server](https://hacks.mozilla.org/2015/02/embedding-an-http-web-server-in-firefox-os/) for Firefox OS
