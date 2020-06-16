"use strict";

const fs = require("fs");
const async = require("async");
const mslg = require("../messagelogger");
const mqtt = require("mqtt");
const LooseParse = require("../utils/utils").LooseParse;

const ConfigurationError = require("../utils/errors").ConfigurationError;
const ValidateConfigurationProperty = require("../utils/utils").ValidateConfigurationProperty;
const ValidateConfigurationStringProperty = require("../utils/utils").ValidateConfigurationStringProperty;

const DATA_TYPES = require("../utils/utils").DATA_TYPES;
const INPUT_TYPES = require("../utils/utils").INPUT_TYPES;

const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;


function dataValueToPoint(node, dataValue, customTimestamp = null) {
    if (node.use_calc && node.calc != null) {
        dataValue = node.calc(dataValue);
    }

    let point = {
        node: node,
        value: dataValue,
        timestamp: new Date().getTime()
    };

    if (customTimestamp){
        point.timestamp = customTimestamp;
    }

    return point;
}

/**
 * @return {boolean}
 */
function PointMatchTypeAndSet(point) {
    // check if the value is a type that we can handle (number or a bool).
    switch (point.node.dataType) {
    case DATA_TYPES.NUMBER: {
        const point_val = Number(point.value);
        if (!isNaN(point_val)) {
            point.value = point_val;
            return true;
        }

        mslg.getmainlogger().warn("Point value could not be converted to a number!");

        break;
    }
    case DATA_TYPES.BOOLEAN: {
        let lower_case_val = String(point.value).toLowerCase();
        if (lower_case_val === "false" || lower_case_val === "true") {
            point.value = lower_case_val === "true";
            return true;
        }
        break;
    }
    case DATA_TYPES.STRING: {
        point.value = String(point.value);
        return true;
    }
    default:
        mslg.getmainlogger().warn(point.node, "Type not supported: ", point.node.dataType);
        return false;
    }
    let message = String(point.node) + "Types don't match: " + String(typeof point.value) + " <->" + String(point.node.dataType);
    mslg.getmainlogger().error(message);
    Sentry.captureMessage(message, Severity.Error);
    return false;
}


class ReadPump_mqtt {
    constructor(input_config, config_measurements, writepump) {
        if(input_config === undefined || input_config === null){
            throw new ConfigurationError("Invalid configuration : input configuration is null or undefined.");
        }

        if(config_measurements === undefined || config_measurements === null){
            throw new ConfigurationError("Invalid configuration : measurement configuration is null or undefined.");
        }

        if(writepump == null || writepump === "undefined"){
            throw new ConfigurationError("Invalid WritePump parameter: null or undefined");
        }

        if(input_config.type !== INPUT_TYPES.MQTT){
            throw new ConfigurationError(`Invalid configuration : input config type should be ${INPUT_TYPES.MQTT}`);
        }

        if (input_config.topicPrefix === undefined || input_config.topicPrefix === null) {
            throw new ConfigurationError("Invalid configuration : mqtt input configuration should contain a valid topic_prefix.");
        }

        this.config = input_config;

        // convert file paths to file content - for certificates
        if (input_config.cert) {
            // eslint-disable-next-line no-sync
            this.config.cert = [fs.readFileSync(input_config.cert)];
        }

        if (input_config.ca) {
            // eslint-disable-next-line no-sync
            this.config.ca = [fs.readFileSync(input_config.ca)];
        }

        if (input_config.key) {
            // eslint-disable-next-line no-sync
            this.config.key = [fs.readFileSync(input_config.key)];
        }

        this.serverUrl = input_config.url;

        // noinspection JSUnresolvedVariable
        this.waitSeconds = input_config.failoverTimeout || 5;
        // for simplicity, make the startdelay constant
        this.startDelay = this.waitSeconds * 1000;

        this.qos = input_config.qos;
        this.mqttClient = null;
        this.measurements = config_measurements;
        this.monitoredItem = {};
        this.monitoredMeasurements = [];
        this.writepump = writepump;

        this.measurementsInitialised = false;

        this.readerDisconnectFunction = function (callback) {
            callback("readerDisconnectFunction is not initialised");
        };

        this.readerMonitoringFunction = function (callback) {
            callback("readerMonitoringFunction is not initialised");
        };
    }

    InitReader(callback)
    {
        let self = this;
        this.DisconnectMqtt(function (err){
            if(err){
                return callback(err);
            }
            mslg.getmainlogger().info("Mqtt Reader : Connecting to", self.serverUrl);
            self.mqttClient = null;
            self.mqttClient = mqtt.connect(self.serverUrl, self.config);
            return callback(null);
        });
        return null;
    }

    DisconnectMqtt(callback) {
        let self = this;
        if(self.mqttClient) {
            self.mqttClient.end(function (err) {
                if (err) {
                    mslg.getmainlogger().error("MQTT reader disconnect failed", err);
                    Sentry.captureMessage(err, Severity);
                    return callback(err);
                }
                return callback(null);
            });
        }
        else{
            return callback(null);
        }

        return null;
    }

    static RegisterTopic(topic_data, callback) {
        const topic = topic_data.topic;
        const mqttClient = topic_data.client;
        const qos = topic_data.qos;

        mqttClient.subscribe(topic, { "qos": qos }, function (err, granted) {
            if(err){
                mslg.getmainlogger().warn("subscription to ", String(topic), " failed");
                return callback(err, false);
            }

            granted.forEach(function (g) {
                if(g.qos === 128){
                    mslg.getmainlogger().debug("MQTT reader : subscription ", String(g.topic), " failed with QOS 128");
                    let error = new Error("Subscription " + String(g.topic) + " failed with QOS 128");
                    Sentry.captureMessage(error, Severity.Error);
                    return callback(error, false);
                }

                mslg.getmainlogger().debug("MQTT reader : subscription ", String(g.topic), " started");
                return callback(null, true);
            });

            return null;
        });
        return null;
    }

    StartMonitoring(callback) {
        let self = this;
        let topic = String(self.config.topicPrefix);
        let topics = [];
        let monitoredItems = {};

        self.monitoredMeasurements.forEach(function (measurement) {
            measurement.nodes.forEach(function (node) {
                let ntopic = topic.concat(node.topic);
                monitoredItems[ntopic] = { node: node, measurement: measurement };
                topics.push({ topic: ntopic, client: self.mqttClient, qos: self.qos});
            });
        });

        async.eachSeries(topics, ReadPump_mqtt.RegisterTopic, function (err){
            if(err){
                self.monitoredItem = {};
                return callback(err);
            }
            self.monitoredItem = monitoredItems;
            return callback(null);
        });
    }

    InstallMessageHandlers() {
        let self = this;
        this.mqttClient.on("message", function (topic, message) {
            if(!(topic in self.monitoredItem)){
                return;
            }

            let monitored_item = self.monitoredItem[topic];

            let node = monitored_item.node;
            let measurement = monitored_item.measurement;

            let point = dataValueToPoint(node, message);
            if (PointMatchTypeAndSet(point)) {
                self.writepump.AddPointsToBuffer(measurement, [point]);
            } else {
                mslg.getmainlogger().error("Invalid point returned from subscription.", PointMatchTypeAndSet(point));
            }
            self.UpdatePointLastData(point);
        });

        this.mqttClient.on("error", function (err) {
            if (err) {
                Sentry.captureMessage(err, Severity.Error);
                mslg.getmainlogger().error("Mqtt Reader : error message : ", err);
            }
        });

        this.mqttClient.on("close", function () {
            mslg.getmainlogger().warn("Mqtt client connection closed. ");
        });

        this.mqttClient.on("connect", function (connack) {
            mslg.getmainlogger().info("Mqtt Reader : Connected to endpoint ", self.serverUrl, " Connack packet : ", connack);
        });

        this.mqttClient.on("offline", function () {
            mslg.getmainlogger().warn("Mqtt reader : client connection to ", self.serverUrl, " went offline!");
        });

        this.mqttClient.on("reconnect", function () {
            mslg.getmainlogger().info("Mqtt reader : client trying to reconnect to ", self.serverUrl);
        });
    }

    // eslint-disable-next-line class-methods-use-this
    UpdatePointLastData(point) {
        point.node.lastValue = point.value;
    }

    static ValidateMeasurement(measurement){
        ValidateConfigurationProperty(measurement, "Invalid/null measurement detected");
        ValidateConfigurationStringProperty(measurement.name, "Invalid/null measurement name detected");
        ValidateConfigurationProperty(measurement.dataType, "Invalid/null measurement dataType detected");
    }

    InitializeMeasurements() {
        let self = this;
        if (this.measurementsInitialised) {
            return;
        }
        this.measurementsInitialised = true;
        self.measurements.forEach(function (measurement) {

            ReadPump_mqtt.ValidateMeasurement(measurement);

            self.monitoredMeasurements.push({
                name: measurement.name,
                dataType: measurement.dataType,
                tags: measurement.tags,
                nodes: ReadPump_mqtt.ParseNodes(measurement),
                deadbandAbsolute: measurement.deadbandAbsolute || 0,
                deadbandRelative: measurement.deadbandRelative || 0,
                lastValue: null
            });
        });
    }

    static ParseNodes(measurement) {
        let nodes = [];

        let dt = measurement.dataType;

        let parseLink = function (measurement_link) {
            ValidateConfigurationStringProperty(measurement_link.in_mqtt, `Invalid MQTT 'in_mqtt' value for measurement ${measurement.name}`);

            nodes.push({
                topic: measurement_link.in_mqtt,
                out_influx: measurement_link.out_influx,
                out_opcua: measurement_link.out_opcua,
                out_mqtt: measurement_link.out_mqtt,
                dataType: dt,
                calc: measurement_link.calc?LooseParse(measurement_link.calc):null,
                use_calc: Boolean(measurement_link.calc)
            });
        };

        if (measurement.topic != null && measurement.field) {
            parseLink(measurement);
        }

        if (measurement.link && measurement.link instanceof Array && measurement.link.length > 0) {
            measurement.link.forEach(parseLink);
        }

        return nodes;
    }

    Run(callback) {
        let self = this;
        setTimeout(function () {
            self.InitializeMeasurements();

            self.InitReader(function(err) {
                if (err) {
                    return callback(err);
                }

                self.InstallMessageHandlers();

                self.StartMonitoring(function (err) {
                    if (err) {
                        mslg.getmainlogger().error("Monitoring error:", err);
                        Sentry.captureMessage(err, Severity.Error);
                        return callback("MQTT monitoring callback error: " + err);
                    }
                    return null;
                });

                return null;
            });
        }, this.startDelay);
    }
}

module.exports = ReadPump_mqtt;
