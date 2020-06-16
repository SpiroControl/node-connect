"use strict";

const async = require("async");
const RecurrenceRule = require("node-schedule").RecurrenceRule;
const schedule = require("node-schedule");
const opcua_base = require("../opcua_connect");
const opcua = require("node-opcua");
const LooseParse = require("../utils/utils").LooseParse;
const ClientSubscription = require("node-opcua").ClientSubscription;
const getmainlogger = require("../messagelogger").getmainlogger;

const DATA_TYPES = require("../utils/utils").DATA_TYPES;
const INPUT_TYPES = require("../utils/utils").INPUT_TYPES;
const SUPPORTED_DATA_TYPES = require("../utils/utils").SUPPORTED_DATA_TYPES;
const OPC_COLLECTION_TYPES = require("../utils/utils").OPC_COLLECTION_TYPES;
const SUPPORTED_OPC_COLLECTION_TYPES = require("../utils/utils").SUPPORTED_OPC_COLLECTION_TYPES;
const GetOPCUAClientSubscriptionSettings = require("../utils/utils").GetOPCUAClientSubscriptionSettings;

const ConfigurationError = require("../utils/errors").ConfigurationError;
const ValidateConfigurationProperty = require("../utils/utils").ValidateConfigurationProperty;
const ValidateConfigurationStringProperty = require("../utils/utils").ValidateConfigurationStringProperty;

const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;


function dataValueToPoint(node, dataValue, customTimestamp = null) {
    let value;
    if (dataValue.value) {
        value = dataValue.value.value;
        if (node.use_calc && node.calc != null) {
            value = node.calc(value);
        }
    }
    else value = 0;

    let point = {
        node: node,
        value: value,
        opcstatus: dataValue.statusCode.name,
        timestamp: dataValue.sourceTimestamp ? dataValue.sourceTimestamp.getTime() : new Date().getTime()
    };

    if (customTimestamp != null) {
        point.timestamp = customTimestamp;
    }

    return point;
}

/**
 * @return {boolean}
 */
function PointIsValid(point) {
    return SUPPORTED_DATA_TYPES.includes(typeof point.value);
}

/**
 * @return {boolean}
 */
function PointMatchesType(point) {
    // check if the value is a type that we can handle (number or a bool).
    let match = typeof point.value === point.node.dataType;
    if (!match) {
        getmainlogger().warn(point.node, "Types don't match: ", typeof point.value, point.node.dataType);
    }
    return match;
}

/**
 * @return {boolean}
 */
function PointIsWithinDeadband(point) {
    // some vars for shorter statements later on.
    let curr = point.value;
    let prev = point.node.lastValue;

    let dba = point.node.deadbandAbsolute;
    let dbr = point.node.deadbandRelative;

    /*
     * return early if the type of the previous value is not the same as the current.
     * this will also return when this is the first value and prev is still undefined.
     */
    let current_type = typeof curr;
    let previous_type = typeof prev;

    if (current_type !== previous_type){
        if(previous_type === "undefined"){
            getmainlogger().debug("Previous type was undefined - probably just starting up...ignoring.  Point :", point);
        }
        else {
            getmainlogger().warn(
                "Value of point ", point, " changed from type",
                previous_type, " to type ", current_type, " -> not within deadband"
            );
            return false;
        }
    }

    /*
     * calculate deadbands based on value type. For numbers, make the
     * calculations for both absolute and relative if they are set. For bool,
     * just check if a deadband has been set and if the value has changed.
     */
    switch (typeof curr) {
    case DATA_TYPES.NUMBER:
        if (dba > 0 && Math.abs(curr - prev) < dba) {
            return true;
        }
        if (dbr > 0 && Math.abs(curr - prev) < Math.abs(prev) * dbr) {
            return true;
        }
        break;
    case DATA_TYPES.BOOLEAN:
        if (dba > 0 && prev === curr)
            return true;
        break;
    case DATA_TYPES.STRING:
        break;
    default:
        Sentry.captureMessage("Unexpected type for deadband calc " + String(point), Severity.Error);
        getmainlogger().error("unexpected type for deadband calc " + String(point));
    }

    // if we get here, value is not within any deadband. Return false;
    return false;
}


// Inherits from OpcuaConnect
class ReadPump_opcua extends opcua_base {
    constructor(input_config, measurements_config, writepump) {
        super(input_config, "node-connect");

        if(input_config === undefined || input_config === null){
            throw new ConfigurationError("Invalid configuration : input configuration is null or undefined.");
        }

        if(measurements_config === undefined || measurements_config === null){
            throw new ConfigurationError("Invalid configuration : measurement configuration is null or undefined.");
        }

        if(writepump === null || writepump === undefined){
            throw new ConfigurationError("Invalid WritePump parameter : null or undefined");
        }

        if(input_config.type !== INPUT_TYPES.OPCUA){
            throw new ConfigurationError("Invalid configuration : input config type should be "+ INPUT_TYPES.OPCUA);
        }

        this.measurements = measurements_config;
        this.polledMeasurements = [];
        this.monitoredMeasurements = [];
        this.writepump = writepump;
        this.pollers = [];
        this.sortedMeasurementsForPolling = {};
        this.measurementsInitialised = false;
        this.waitSeconds = input_config.failoverTimeout || 5;
        this._subscription = null;

        this.readerDisconnectFunction = function (callback) {
            callback("readerDisconnectFunction is not initialised");
        };
        this.readerPollingFunction = function (callback) {
            callback("readerPollingFunction is not initialised");
        };
        this.readerMonitoringFunction = function (callback) {
            callback("readerMonitoringFunction is not initialised");
        };
    }

    InitReader(init_callback) {
        let self = this;
        // declare 2 vars to avoid double callbacks
        let monitoringCallbackCalled = false;
        let pollingCallbackCalled = false;

        self.readerMonitoringFunction = function (callback) {
            self.StartOPCMonitoring(function (err) {
                if (!monitoringCallbackCalled) {
                    monitoringCallbackCalled = true;
                    return callback(err);
                }
                return null;
            });
        };

        self.readerPollingFunction = function (callback) {
            self.StartOPCPolling(function (err) {
                if (self.pollers.length > 0 && err) {
                    Sentry.captureMessage(err, Severity.Error);
                    getmainlogger().error("OPCUA polling stopping because of error : ", err);

                    self.pollers.forEach(function (poller) {
                        poller.cancel();
                    });
                    self.pollers = [];
                    self.sortedMeasurementsForPolling = {};
                }

                if (!pollingCallbackCalled) {
                    pollingCallbackCalled = true;
                    if(err) {
                        return callback("Polling error: " + String(err));
                    }
                    return callback();
                }
                getmainlogger().warn("Polling callback already called");
                return null;
            });
        };

        self.readerDisconnectFunction = self.DisconnectOPCUA;
        self.ConnectOPCUA(init_callback);
    }

    ExecuteOPCUAReadRequest(nodes, useSourceTimestamp, callback) {
        let self = this;
        // set a timestamp for the results. If useSourceTimestamp, set t = null.
        let timestamp = useSourceTimestamp ? null : new Date().getTime(); // date in ms rounded to the second.
        if (!self.uaSession) {
            callback("The readpump has no active session. Can't read.");
            return;
        }

        if(self.uaSession.hasBeenClosed() || !self.uaSession.isChannelValid()){
            callback("Session has been closed or invalid session..holding off reading!");
            return;
        }

        self.uaSession.read(nodes, 0, function (err, dataValues) {
            if (err) {
                callback(err, []);
                return;
            }
            let results = [];
            dataValues.forEach(function (data_value, i) {
                let res = dataValueToPoint(nodes[i], data_value, timestamp);
                results.push(res);
            });
            callback(null, results);
        });
    }

    StopMonitoringSubscription(){
        let self = this;
        return new Promise((resolve, reject) => {
            if(self._subscription === null){
                resolve();
            }
            else {
                self._subscription.terminate().then(
                    function resolved() {
                        self._subscription = null;
                        resolve();
                    },
                    function rejected(err) {
                        self._subscription = null;
                        reject(err);
                    }
                );
            }
        });
    }

    StartOPCMonitoring(callback) {
        this.StopMonitoringSubscription().then(
            function resolved (){
                getmainlogger().debug("Previous OPCUA client subscription terminated.");
            },
            function rejected(err) {
                getmainlogger().warn("Previous OPCUA client subscription failed to terminate : ", err);
            }
        );

        if(this.monitoredMeasurements.length <= 0) {
            getmainlogger().warn("No measurements configured for monitoring : OPC monitoring will not be started");
            return;
        }

        this.uaClient.on("close", function (err) {
            // break the run loop !
            callback(err);
        });

        // create an OPCUA subscription
        let client_subscription = ClientSubscription.create(
            this.uaSession,
            GetOPCUAClientSubscriptionSettings(this.config)
        );

        this._subscription = client_subscription;

        client_subscription.on("started", function () {
            getmainlogger().info("OPCUA subscription ", client_subscription.subscriptionId, " started");
        }).on("keepalive", function () {
            getmainlogger().debug("OPCUA subscription ", client_subscription.subscriptionId, " keepalive");
        }).on("terminated", function () {
            let err = "OPCUA subscription was terminated";
            getmainlogger().error(err);
            Sentry.captureMessage(err, Severity.Error);
            callback(err);
        });

        let self = this;

        /*
         * install a monitored item on the subscription for each measurement in
         * the readpump's monitored items.
         */
        self.monitoredMeasurements.forEach(function (monitored_measurement) {
            monitored_measurement.nodes.forEach(function (node) {

                let uaMonitoredItem = opcua.ClientMonitoredItem.create(
                    client_subscription,
                    node,
                    {
                        samplingInterval: monitored_measurement.monitorResolution,
                        discardOldest: true,
                        queueSize: 100
                    }
                    , opcua.TimestampsToReturn.Both
                );

                uaMonitoredItem.on("changed", function (dataValue) {
                    let point = dataValueToPoint(node, dataValue);
                    let statusChanged = point.node.lastOpcstatus !== point.opcstatus;
                    if (point.opcstatus === "Good") {
                        if (PointIsValid(point) && PointMatchesType(point)) {
                            self.writepump.AddPointsToBuffer(monitored_measurement, [point]);
                        }
                        else {
                            getmainlogger().warn("Invalid point returned from subscription.", PointIsValid(point), PointMatchesType(point));
                        }
                        // log point status changes
                        if (statusChanged) {
                            ReadPump_opcua.LogPointStatusChanges(point);
                        }
                    }
                    else if (statusChanged) {
                        ReadPump_opcua.LogPointStatusChanges(point);
                    }
                    self.UpdatePointLastData(point);
                });

                uaMonitoredItem.on("terminated", function (err_message) {
                    Sentry.captureMessage(err_message, Severity.Error);
                    getmainlogger().error(`OPCUA - Monitored Item -terminated! ${uaMonitoredItem} -  ERROR : ${err_message}`);
                });

                uaMonitoredItem.on("err", function (err_message) {
                    getmainlogger().error(uaMonitoredItem.itemToMonitor.nodeId.toString(), " ERROR :", err_message);
                    Sentry.captureMessage(err_message, Severity.Error);
                    callback(err_message);
                });
            });
        });
    }

    SortMeasurementPollers(measurement) {
        let self = this;
        let rule = new RecurrenceRule();
        let pollRate = measurement.pollRate;
        let interval = 60 / pollRate;
        let key = interval.toString();
        let i = 0;

        if (interval >= 1 <= 60) {
            let seconds = [];
            while (i < 60) {
                seconds.push(i);
                i = i + interval;
            }
            rule.second = seconds;
        }
        else {
            let intervalInMinutes = Math.round(interval / 60);
            while (60 % intervalInMinutes !== 0) {
                intervalInMinutes = intervalInMinutes + 1;
            }
            let minutes = [];
            while (i < 60) {
                minutes.push(i);
                i = i + intervalInMinutes;
            }
            rule.minute = minutes;
            rule.second = 0;
        }
        if (self.sortedMeasurementsForPolling[key]) {
            self
                .sortedMeasurementsForPolling[key]
                .measurements
                .push(measurement);
        }
        else {
            self.sortedMeasurementsForPolling[key] = {
                scheduleRule: rule,
                measurements: [measurement]
            };
        }
    }

    static LogPointStatusChanges(point) {
        if (point.opcstatus === "Good") {
            getmainlogger().debug("Node ", point.node.nodeId.value, " is online");
        }
        else {
            let statusToLog = point.opcstatus || "None";
            getmainlogger().warn("Node ", point.node.nodeId.value, " is unavailabale (status is ", statusToLog, ")");
        }
    }

    /*
     * We keep the next function non-static to be able to easily create a test-spy on this method for every object.
     *
     */
    // eslint-disable-next-line class-methods-use-this
    UpdatePointLastData(point) {
        point.node.lastValue = point.value;
        point.node.lastOpcstatus = point.opcstatus;
    }

    StartOPCPolling(callback) {
        if(this.polledMeasurements.length <= 0){
            getmainlogger().warn("No measurements configured for polling : OPC polling will not be started");
            return;
        }

        this.uaClient.on("close", function (err) {
            // break the run loop !
            callback(err);
        });

        let self = this;
        this.polledMeasurements.forEach(function (measurement) {
            self.SortMeasurementPollers(measurement);
        });

        for (const container of Object.values(self.sortedMeasurementsForPolling)) {
            let poller = schedule.scheduleJob(container.scheduleRule, function () {
                self._poll_job(callback, container);
            });
            self.pollers.push(poller);
        }
    }

    _poll_job(callback, container) {
        let self = this;
        if (self.uaSession.hasBeenClosed() || !self.uaSession.isChannelValid()) {
            // break main loop to re-establish connection
            callback("Session has been closed or the channel is invalid...breaking main loop!");
            return;
        }

        container.measurements.forEach(function (measurement) {
            // noinspection JSUnresolvedVariable
            self.ExecuteOPCUAReadRequest(measurement.nodes, self.config.useSourceTimeStamp, function (err, results) {
                if (err) {
                    getmainlogger().warn("ExecuteOPCUAReadRequest failed : ", err);
                    return;
                }

                /*
                 * filter the results. Check for deadband. If all checks pass, set
                 * the measurement's lastValue
                 */
                results = results.filter(function (point) {
                    let statusChanged = point.node.lastOpcstatus !== point.opcstatus;
                    if (point.opcstatus === "Good") {
                        if (!PointIsValid(point) || !PointMatchesType(point)) {
                            // Set de default value for the type specified
                            getmainlogger().warn("Invalid point:", point.node.name, point.node.nodeId.value, point.value);
                            switch (point.node.dataType) {
                            case DATA_TYPES.BOOLEAN:
                                point.value = false;
                                break;
                            case DATA_TYPES.NUMBER:
                                point.value = 0;
                                break;
                            case DATA_TYPES.STRING:
                                point.value = "";
                                break;
                            default:
                                getmainlogger().warn("No valid datatype, ignoring point ", point.node.nodeId.value);
                                return false;
                            }
                        }
                        // Check for deadband
                        if (PointIsWithinDeadband(point))
                            return false;
                        if (!PointMatchesType(point)) {
                            getmainlogger().warn("Invalid type returned from OPC. Ignoring point", point);
                            return false;
                        }
                        // log point status changes
                        if (statusChanged) {
                            ReadPump_opcua.LogPointStatusChanges(point);
                        }

                        /*
                         * if we retain the point, we must update the measurment's
                         * last value!
                         */
                        self.UpdatePointLastData(point);
                    } else {
                        if (statusChanged) {
                            ReadPump_opcua.LogPointStatusChanges(point);
                        }
                        self.UpdatePointLastData(point);
                        // skip bad node
                        return false;
                    }
                    return true;
                });
                if (results.length > 0) {
                    self.writepump.AddPointsToBuffer(measurement, results);
                }
            });
        });
    }

    static ValidateMeasurement(measurement){
        ValidateConfigurationProperty(measurement, "Invalid/null measurement detected");
        ValidateConfigurationStringProperty(measurement.name, "Invalid/null measurement name detected");
        ValidateConfigurationProperty(measurement.dataType, "Invalid/null measurement dataType detected");

        if (!Object.prototype.hasOwnProperty.call(measurement, "collectionType")) {
            throw new ConfigurationError(`Property collectionType not found for measurement ${measurement.name}`);
        }

        // noinspection JSUnresolvedVariable
        if(!SUPPORTED_OPC_COLLECTION_TYPES.includes(measurement.collectionType)){
            throw new ConfigurationError(`Measurement ${measurement.name} has an invalid collectionType value.`);
        }
    }

    InitializeMeasurements(){
        let self = this;
        if (this.measurementsInitialised) {
            return;
        }

        self.measurements.forEach(function (measurement) {
            ReadPump_opcua.ValidateMeasurement(measurement);

            // noinspection JSUnresolvedVariable
            switch (measurement.collectionType) {
            case OPC_COLLECTION_TYPES.MONITORED:
                self._add_monitored_measurement(measurement);
                break;
            case OPC_COLLECTION_TYPES.POLLED:
                self._add_polled_measurement(measurement);
                break;
            default:
                throw new ConfigurationError(`Invalid collectionType for measurement ${measurement.name}`);
            }
        });

        this.measurementsInitialised = true;
    }

    _add_polled_measurement(measurement) {
        if (!Object.prototype.hasOwnProperty.call(measurement, "pollRate")){
            throw new ConfigurationError(`Measurement ${measurement.name} was specified as polled but has no pollRate specification`);
        }

        if(measurement.pollRate > 60) {
            // Pollrate input is in samples / minute.
            throw new ConfigurationError(`Measurement ${measurement.name} was specified with wrong pollRate specification.  Should be <= 60.`);
        }

        if(measurement.pollRate === 0) {
            // Pollrate input is in samples / minute.
            throw new ConfigurationError(`Measurement ${measurement.name} was specified with wrong pollRate specification.  Should not be 0..`);
        }

        let pollRate = measurement.pollRate;
        let originalPollRate = measurement.pollRate;
        let pollRateCorrected = false;

        if (measurement.pollRate > 1) {
            pollRate = Math.round(measurement.pollRate);
            while (60 % pollRate !== 0) {
                pollRate = pollRate + 1;
                pollRateCorrected = true;
            }
        }

        if (measurement.pollRate < 1) {
            let pollIntervalInSeconds = Math.round(60 / measurement.pollRate);
            while (pollIntervalInSeconds % 60 !== 0) {
                pollIntervalInSeconds = pollIntervalInSeconds - 1;
                pollRateCorrected = true;
            }
            pollRate = 60 / pollIntervalInSeconds;
        }

        if (pollRateCorrected) {
            getmainlogger().warn("The pollrate for measurement ", measurement, " was corrected from ", originalPollRate, " to ", pollRate);
        }

        this.polledMeasurements.push({
            name: measurement.name,
            dataType: measurement.dataType,
            tags: measurement.tags,
            nodes: ReadPump_opcua.ParseNodes(measurement),
            pollRate: pollRate,
            deadbandAbsolute: measurement.deadbandAbsolute || 0,
            deadbandRelative: measurement.deadbandRelative || 0,
            lastValue: null,
            lastOpcstatus: null
        });
    }

    _add_monitored_measurement(measurement) {
        if (!Object.prototype.hasOwnProperty.call(measurement, "monitorResolution")) {
            throw new ConfigurationError(`Measurement ${measurement.name} was specified as monitored but has no monitorResolution`);
        }

        this.monitoredMeasurements.push({
            name: measurement.name,
            dataType: measurement.dataType,
            tags: measurement.tags,
            nodes: ReadPump_opcua.ParseNodes(measurement),
            monitorResolution: measurement.monitorResolution,
            deadbandAbsolute: measurement.deadbandAbsolute || 0,
            deadbandRelative: measurement.deadbandRelative || 0,
            lastValue: null,
            lastOpcstatus: null
        });
    }


    static ParseNodes(measurement) {
        let nodes = [];
        let dt = measurement.dataType;

        let parseFunc = function (measurement_link) {
            ValidateConfigurationStringProperty(measurement_link.in_opcua, `Invalid OPCUA 'in_opcua' value for measurement ${measurement.name}`);

            nodes.push({
                nodeId: measurement_link.in_opcua,
                out_influx: measurement_link.out_influx,
                out_opcua: measurement_link.out_opcua,
                out_mqtt: measurement_link.out_mqtt,
                attributeId: opcua.AttributeIds.Value,
                dataType: dt,
                calc: measurement_link.calc?LooseParse(measurement_link.calc):null,
                use_calc: Boolean(measurement_link.calc)
            });
        };
        if (measurement.nodeId && measurement.field) {
            parseFunc(measurement);
        }
        if (measurement.link !== null && measurement.link instanceof Array && measurement.link.length > 0) {
            measurement.link.forEach(parseFunc);
        }
        return nodes;
    }

    _cancel_existing_pollers(){
        this.pollers.forEach(function(poller) {
            schedule.cancelJob(poller);
        });
        this.pollers = [];
    }

    DisconnectOPCUA(callback) {
        let self = this;
        this.StopMonitoringSubscription().then(
            function resolve() {
                self._cancel_existing_pollers();
                return self._disconnect_impl(callback);
            }
            ,
            function reject(){
                self._cancel_existing_pollers();
                return self._disconnect_impl(callback);
            }
        );
    }

    Run(callback) {
        let self = this;
        let timeout = self.waitSeconds * 1000;

        setTimeout(function () {
            self.InitializeMeasurements();
            async.waterfall(
                [
                    function (waterfall_next) {
                        // connect opc
                        self.InitReader(waterfall_next);
                    },

                    /*
                     * Start both the monitoring and the polling of the measurments.
                     * In case of an error, close everything.
                     */
                    function (waterfall_next) {
                        async.parallel({
                            monitoring: self.readerMonitoringFunction,
                            polling: self.readerPollingFunction
                        }, function (err) {
                            waterfall_next(err);
                        });
                    }
                ],
                function (err) {
                    // final callback
                    callback(err);
                }
            );
        }, timeout);
    }
}

module.exports = ReadPump_opcua;
