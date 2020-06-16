"use strict";

const mqtt = require("mqtt");
const mslg = require("../messagelogger");


class MqttWriterMock{
    constructor() {
        this._interval = null;

        this._options = {
            username: "",
            password: "",
            protocolId: "MQTT",
            debug: true
        };

        this.mqttOutput = null;
    }

    Connect(host, callback) {
        this.mqttOutput = new mqtt.connect(host, this._options);

        this.mqttOutput.on("offline", function () {
            mslg.getmainlogger().warn("Mqtt writer : client connection to ", host, " is offline!");
        });

        this.mqttOutput.on("reconnect", function () {
            mslg.getmainlogger().debug("Mqtt writer : client trying to reconnect to ", host);
        });

        this.mqttOutput.on("connect", function () {
            mslg.getmainlogger().info("Mqtt writer : Connected to ", host);
            callback();
        });

        this.mqttOutput.on("error", function (error) {
            mslg.getmainlogger().error("Mqtt writer : Could not connect to ", host, " : ", error);
            callback(error);
        });
    }

    StartWriting(host, topic_list){
        if(this._interval !== null){
            return;
        }

        let self = this;
        this.Connect(host, function (err){
            if(err){
                return;
            }

            let counter = 20;
            self._interval = setInterval(function (){
                topic_list.forEach(function (topic){
                    counter = counter + 1;

                    self.mqttOutput.publish(topic, String(counter), function (err){
                        if(err) {
                            mslg.getmainlogger().error("Mqtt mock writer : unable to write to ", topic, " : ", err);
                        }
                        else {
                            mslg.getmainlogger().info("Mqtt mock writer : write", counter, " to topic ", topic, " Success!");
                        }
                    });
                });
            }, 1000);
        });
    }

    StopWriting(){
        clearInterval(this._interval);
        this._interval = null;
        this.mqttOutput.end();
    }
}


const server = new MqttWriterMock();


function start_server(host, topics){
    server.StartWriting(host, topics);
}


function stop_server(){
    server.StopWriting();
}

module.exports.start_server = start_server;
module.exports.stop_server = stop_server;
