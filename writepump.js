"use strict";

const validate_buffer_entry = require("./data_validators").validate_buffer_entry;

const async = require("async");
const path = require("path");

const Datastore = require("nedb");
const get_logger = require("./messagelogger").get_writepump_logger;

const InfluxDbWriter = require("./writers/influxdbwriter");
const MqttWriter = require("./writers/mqttwriter");
const OpcuaWriter = require("./writers/opcuawriter");

const validate_point_array = require("./data_validators").validate_point_array;
const OUTPUT_TYPES = require("./utils/utils").OUTPUT_TYPES;

const ConfigurationError = require("./utils/errors").ConfigurationError;
const WritePumpReporting = require("./writepump_reporting");

const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;


function get_db_path(output_config){
    if(output_config.name === undefined || output_config.name === null){
        throw new ConfigurationError("Invalid configuration : output config name undefined.");
    }

    let dbname = null;
    if(!output_config.name.endsWith(".db")){
        dbname = output_config.name + ".db";
    }
    else{
        dbname = output_config.name;
    }

    // eslint-disable-next-line no-undef
    let dir = process.env.BUFFER_LOCATION || __dirname;
    return path.resolve(dir, dbname);
}

function load_db(buffer){
    const promise = new Promise((resolve, reject) =>
    {
        const callback = (error) => error ? reject(error) : resolve(error);
        buffer.loadDatabase(callback);
    });

    promise
        .then(() => {
            get_logger().debug("Succesfully loaded buffer database.");
        })
        .catch(error => {
            get_logger().error(error);
            Sentry.captureException(error);
            process.exit(2);
        });
}

function get_output_config(point, config_type) {
    switch (config_type) {
    case OUTPUT_TYPES.INFLUXDB:
        if (!(point.node.out_influx === undefined)) {
            return point.node.out_influx;
        }
        break;
    case OUTPUT_TYPES.MQTT:
        if (!(point.node.out_mqtt === undefined)) {
            return point.node.out_mqtt;
        }
        break;
    case OUTPUT_TYPES.OPCUA:
        if (!(point.node.out_opcua === undefined)) {
            return point.node.out_opcua;
        }
        break;
    }

    return null;
}

function convert_point_to_entry(measurement, point, counter, config_type) {
    let output_config = get_output_config(point, config_type);
    if(output_config === undefined || output_config === null || output_config === ""){
        get_logger().warn("Output configured as empty or null - skipping point " + String(point));
        Sentry.captureMessage("Output configured as empty or null - skipping point!" + String(point), Severity.Warning);
        return null;
    }

    // opc status should also be included in tags.
    let entry = {
        measurement_name: measurement.name,
        timed_value: {
            time: point.timestamp,
            value: point.value
        },
        tags: Object.assign({}, measurement.tags),
        output_config: output_config,
        i: counter
    };

    return validate_buffer_entry(entry);
}


class WritePump {
    constructor(output_config, in_memory=false) {
        if(output_config === undefined || output_config === null){
            throw new ConfigurationError("Invalid configuration : output configuration is invalid.");
        }

        if(output_config.bufferMaxSize === undefined || output_config.bufferMaxSize === null){
            throw new ConfigurationError("Invalid configuration : output configuration needs the bufferMaxSize setting.");
        }

        if (typeof output_config.name === "undefined") {
            throw new ConfigurationError("name must be defined for writepump to start");
        }

        this.buffer = null;
        if(in_memory){
            // noinspection JSCheckFunctionSignatures
            this.buffer = new Datastore({inMemoryOnly: true, autoload: true});
        }
        else {
            let db_path = get_db_path(output_config);
            get_logger().info("Creating Datastore in '" + db_path + "' for buffering updates.");

            // noinspection JSCheckFunctionSignatures
            this.buffer = new Datastore({filename: db_path, autoload: false});
            load_db(this.buffer);
        }

        this.iii = 0;
        this.name = output_config.name;
        this.config = output_config;
        // noinspection JSUnresolvedVariable
        this.reportIntervalMs = output_config.reportIntervalSeconds *1000 || 60 * 1000; // report every minute the number of items written.
        // noinspection JSUnresolvedVariable
        this.writeLimit = output_config.writeMaxPoints || 1000;
        // noinspection JSUnresolvedVariable
        this.writeInterval = output_config.writeInterval || 5000;
        // noinspection JSUnresolvedVariable
        this.dropOnFailWrite = output_config.dropOnFailWrite || false; // if write fails, drop values from buffer and dont try writing these values again

        this.writeReporting = new WritePumpReporting(this.reportIntervalMs);

        this.writer = null;

        this.Connect = function () {
            throw new Error("Connect function is not defined!");
        };
        this.writeFunction = function () {
            throw new Error("Write function is not defined!");
        };

        this.ConfigureWriter();
    }

    ConfigureWriter() {
        let type = this.config.type;

        switch (type) {
        case OUTPUT_TYPES.INFLUXDB:
            this.writer = new InfluxDbWriter(this.config);
            break;
        case OUTPUT_TYPES.MQTT:
            this.writer = new MqttWriter(this.config);
            break;
        case OUTPUT_TYPES.OPCUA:
            this.writer = new OpcuaWriter(this.config);
            break;
        default:
            throw new ConfigurationError("Invalid writer configuration : unknown type '" + String(type) + "'");
        }

        let self = this;
        self.writeFunction = function (docs, callback) {
            return self.writer.Write(docs, callback);
        };

        self.Connect = function (callback) {
            return self.writer.Connect(callback);
        };

        get_logger().info("Using " + String(type) + " writer");
    }

    /**
     * Execute one write cycle.
     */
    _exec_write_cycle(callback){
        let self = this;
        self.printNumberOfItemsInBuffer("Starting write cycle");

        async.waterfall([
            function (waterfall_next) {
                get_logger().debug("Extracting items from buffer");
                self.buffer.find({}, {}).limit(self.writeLimit).exec(waterfall_next);
            },
            function (buffer_entries, waterfall_next) {
                if(buffer_entries.length <= 0){
                    get_logger().debug("Zero buffer entries found - not writing.");
                    waterfall_next(null, [], []);
                    return;
                }

                get_logger().debug("Writing extracted items from buffer");
                self.writeReporting.RegisterWriteCycle();
                self.writeFunction(buffer_entries, waterfall_next);

            }
        ], function (err, ids_pass, ids_fail) {
            let numberProcessed = ids_pass.length;
            if (err) {
                Sentry.captureMessage(err, Severity.Error);
                get_logger().error("Waterfall error handler : write failed : ", self.name, err);
                get_logger().debug("Waterfall error handler : number of items processed.", ids_pass.length);
            }
            else {
                self.writeReporting.RegisterWrites(numberProcessed);
                self.writeReporting.LogWriteReport();
            }

            if (ids_pass.length > 0) {
                self.printNumberOfItemsInBuffer("Removing written points from buffer");
                self.buffer.remove({ _id: { $in: ids_pass } }, { multi: true }, function (err, n) {
                    if (err) {
                        get_logger().error("Failed to remove written points from buffer: ", n);
                        Sentry.captureMessage(err, Severity.Error);
                    }
                    self.printNumberOfItemsInBuffer("After removal of written points");
                });
            }

            if (ids_fail.length > 0 && self.dropOnFailWrite) {
                get_logger().info("Removing failed points from buffer (dropOnFailWrite)");
                self.buffer.remove({ _id: { $in: ids_fail } }, { multi: true }, function (err, n) {
                    if (err) {
                        get_logger().error("Failed to remove failed points from buffer: ", n);
                        Sentry.captureMessage(err, Severity.Error);
                    }
                    self.printNumberOfItemsInBuffer("After removal of failed points");
                });
                numberProcessed = numberProcessed + ids_fail.length;
            }
            let calculatedWaitTime = self.writeInterval;

            if (numberProcessed < self.writeLimit) {
                get_logger().debug("Compacting buffer data file.");
                self.buffer.persistence.compactDatafile();
            }
            else {
                if(numberProcessed === self.writeLimit){
                    let message = "Write cycle : tried writing max amount of entries that " +
                        "can be written (writeMaxPoints)";
                    get_logger().warn(message);
                    Sentry.captureMessage(message, Severity.Warning);
                }
                else{
                    let message = "Write cycle : tried writting more entries than allowed (writeMaxPoints)";
                    get_logger().error(message);
                    Sentry.captureMessage(message, Severity.Error);
                }

                calculatedWaitTime = 0;
            }

            self.printNumberOfItemsInBuffer("End of write cycle");

            self._checkBufferLimit().then(function(number_items_removed){
                if(number_items_removed > 0) {
                    let message = "Removed " + String(number_items_removed) + " old docs from buffer. Buffer size may be too small";
                    get_logger().warn(message);
                    Sentry.captureMessage(message, Severity.Warning);
                }
            }, function(error){
                get_logger().error(self.name, "Error while deleting items in buffer.", error);
                Sentry.captureMessage(error, Severity.Error);
            });
            setTimeout(function() {
                callback();
            }, calculatedWaitTime);
        });
    }

    /**
     * Start the instance's writepump.
     */
    Run() {
        let self = this;

        self.Connect(function (err) {
            if (err) {
                get_logger().error("Could not connect output of write pump : ", err);
                Sentry.captureMessage(err, Severity.Error);
            }
        });

        this.writeReporting.Reset();

        async.forever(function (next) {
            self._exec_write_cycle(next);
        }, function (err) {
            if (err) {
                get_logger().error(self.name, err);
                Sentry.captureMessage(err, Severity.Error);
            }
        });
    }

    /**
     * Adds a datapoint to the instance's writebuffer.
     */
    AddPointsToBuffer(measurement, points) {
        let validated_points = validate_point_array(points);
        let self = this;

        validated_points.forEach(function (point) {
            self.iii++;
            let buffer_entry = convert_point_to_entry(measurement, point, self.iii, self.config.type);
            if (buffer_entry != null) {
                self.buffer.insert(buffer_entry, function (err, newDoc) {
                    if (err) {
                        Sentry.captureMessage(err, Severity.Error);
                        get_logger().error(self.name, "Error writing to buffer. Entry:", newDoc, ", Err:", err);
                    }
                });
            }
        });
    }

    _checkBufferLimit() {
        this.printNumberOfItemsInBuffer("Checking buffer limit : ");

        let self = this;
        return new Promise(function(resolve, reject) {
            self.buffer.find({}, {}).sort({i: 1}).exec(function (err, docs) {
                if(err){
                    reject(err);
                    return;
                }

                let numberOfItemsToDelete = docs.length - self.config.bufferMaxSize;
                if (numberOfItemsToDelete <= 0) {
                    resolve(0);
                    return;
                }

                let toDelete = [];
                let i = 0;
                while (i < numberOfItemsToDelete) {
                    toDelete.push(docs[i]._id);
                    i++;
                }

                get_logger().debug("Trying to delete ", toDelete.length, " docs from writepump buffer");
                self.buffer.remove({_id: {$in: toDelete}}, {multi: true}, function (err, numRemoved) {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(numRemoved);
                    }
                });
            });
        });
    }

    printNumberOfItemsInBuffer(context="") {
        this.buffer.count({}, function (err, count) {
            get_logger().debug(context, "Number of total items in buffer : ", count);
        });
    }

    GetNumberOfPointsInBuffer(){
        return new Promise((resolve, reject) => {
            const callback = (error, count) => error ? reject(error) : resolve(count);
            this.buffer.count({}, callback);
        });
    }
}

module.exports = WritePump;
