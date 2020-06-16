"use strict";

const validate_buffer_entry_array = require("../data_validators").validate_buffer_entry_array;

const InfluxDB = require("influx").InfluxDB;
const mslg = require("../messagelogger");
const BaseWriter = require("./basewriter");
const Sentry = require("@sentry/node");
const fs = require("fs");

const ValidateConfigurationStringProperty = require("../utils/utils").ValidateConfigurationStringProperty;


class InfluxDbWriter extends BaseWriter{
    constructor(output_config) {
        super(output_config);

        ValidateConfigurationStringProperty(output_config.host, "Invalid hostname");
        ValidateConfigurationStringProperty(output_config.database, "Invalid database");

        let options = {
            host: output_config.host,
            username: output_config.username,
            password: output_config.password,
            database: output_config.database
        };
        if (output_config.port) {
            options.port = output_config.port; // optional, default 8086
        }
        if (output_config.protocol) {
            options.protocol = output_config.protocol; // optional, default 'http'
        }
        if (output_config.RequestOptions) {
            options.options = output_config.RequestOptions; // optional, RequestOptions, to set rejectUnauthorized
            if(output_config.RequestOptions.cert) {
                // eslint-disable-next-line no-sync
                options.options.cert = fs.readFileSync(output_config.RequestOptions.cert);
            }
            if(output_config.RequestOptions.ca) {
                // eslint-disable-next-line no-sync
                options.options.ca = fs.readFileSync(output_config.RequestOptions.ca);
            }
            if(output_config.RequestOptions.key) {
                // eslint-disable-next-line no-sync
                options.options.key = fs.readFileSync(output_config.RequestOptions.key);
            }
        }

        this._options = options;
        this._influxOutput = new InfluxDB(this._options);

        if (output_config.retentionPolicy) {
            this._writeOptions = {
                precision: "ms",
                retentionPolicy: output_config.retentionPolicy
            };
        }
        else{
            this._writeOptions = {
                precision: "ms"
            };
        }
    }

    Connect(callback){
        mslg.getmainlogger().info(
            "Influx Writer : host ", this._options.host,
            " and database ", this._options.database
        );
        return callback();
    }

    Write(docs, callback) {
        let validated_docs = validate_buffer_entry_array(docs);

        if(docs.length <= 0){
            mslg.getmainlogger().debug("Empty docs length : callback without writing to influx.");
            callback(null, [], []);
            return;
        }

        let points = [];
        let ids = [];

        validated_docs.forEach(function (entry) {
            BaseWriter.ValidateEntry(entry);

            try {
                const measurement_name = entry.measurement_name;

                let point = {
                    measurement: measurement_name,
                    tags: entry.tags,
                    fields: {},
                    timestamp: entry.timed_value.time
                };

                point.fields[entry.output_config] = entry.timed_value.value;
                points.push(point);
                ids.push(entry._id);
            }
            catch (e) {
                mslg.getmainlogger().error("Unable to convert entry ", entry, " to Influx point : ", e);
                Sentry.captureException(e);
            }
        });

        if(points.length <= 0)
        {
            mslg.getmainlogger().debug("Empty points length : callback without writing to influx.");
            callback(null, ids, []);
            return;
        }

        const promise = this._influxOutput.writePoints(points, this._writeOptions);

        promise.then(function resolve(){
            mslg.getmainlogger().debug("Succesfully written ", points.length, "  influx values.");
            callback(null, ids, []);
        }, function reject(reason){
            mslg.getmainlogger().warn("Unable to write influx db values.", " Reason : ", reason);
            callback(reason, [], ids);
        }).catch(function (e) {
            mslg.getmainlogger().error(e);
            Sentry.captureException(e);
            callback(e, [], ids);
        });
    }
}


module.exports = InfluxDbWriter;
