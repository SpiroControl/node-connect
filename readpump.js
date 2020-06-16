"use strict";

const async = require("async");
const get_logger = require("./messagelogger").get_readpump_logger;
const opcuaReader = require("./readers/readpump_opcua");
const mqttReader = require("./readers/readpump_mqtt");
const ConfigurationError = require("./utils/errors").ConfigurationError;

const INPUT_TYPES = require("./utils/utils").INPUT_TYPES;

const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;


class ReadPump {
    constructor(config_input, config_measurements, writepump) {
        if(config_input === undefined || config_input === null){
            throw new ConfigurationError("Invalid configuration : input configuration is invalid.");
        }

        if(config_measurements === undefined || config_measurements === null){
            throw new ConfigurationError("Invalid configuration : measurement configuration is invalid.");
        }

        if(typeof writepump === "undefined" || writepump == null){
            throw new ConfigurationError("Invalid WritePump : null or undefined");
        }

        this.name = config_input.name;
        let type = config_input.type;

        switch (type) {
        case INPUT_TYPES.OPCUA:
            this.reader = new opcuaReader(config_input, config_measurements, writepump);
            break;
        case INPUT_TYPES.MQTT:
            this.reader = new mqttReader(config_input, config_measurements, writepump);
            break;
        default:
            throw new ConfigurationError("Invalid ReadPump type value '" + String(type));
        }

        get_logger().info("Using " + String(type) + " reader");
    }


    /**
     * Start the instance's Readpump.
     */
    Run() {
        let reader = this.reader;
        async.forever(
            function (forever_next) {
                reader.Run(function (err) {
                    if(err) {
                        get_logger().error("Error occured in reader.Run() :", err);
                        Sentry.captureMessage(err, Severity.Error);
                    }
                    else {
                        let message = "Restarting reader run cycle (no error provided in callback)";
                        get_logger().warn(message);
                        Sentry.captureMessage(message, Severity.Warning);
                    }
                    forever_next();
                });
            },
            function (err) {
                get_logger().error("Error occurred while running Readpump :", err);
                Sentry.captureMessage(err, Severity.Error);
            }
        );
    }
}

module.exports = ReadPump;
