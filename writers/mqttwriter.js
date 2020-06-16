"use strict";

const validate_buffer_entry_array = require("../data_validators").validate_buffer_entry_array;

const fs = require("fs");
const mqtt = require("mqtt");
const getmainlogger = require("../messagelogger").getmainlogger;
const BaseWriter = require("./basewriter");
const async = require("async");
const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;

const ValidateConfigurationStringProperty = require("../utils/utils").ValidateConfigurationStringProperty;


class MqttWriter extends BaseWriter{
    constructor(output_config) {
        super(output_config);

        ValidateConfigurationStringProperty(output_config.url, "Invalid MQTT writer url config : ");
        ValidateConfigurationStringProperty(output_config.topicPrefix, "Invalid MQTT writer topic config : ", false);

        this._topic_prefix = output_config.topicPrefix;

        this._host = output_config.url.trim();

        this._options = {
            username: output_config.username,
            password: output_config.password,
            protocolId: "MQTT"
        };

        // convert file paths to file content - for certificates
        if (output_config.cert) {
            // eslint-disable-next-line no-sync
            this.config.cert = [fs.readFileSync(output_config.cert)];
        }

        if (output_config.ca) {
            // eslint-disable-next-line no-sync
            this.config.ca = [fs.readFileSync(output_config.ca)];
        }

        if (output_config.key) {
            // eslint-disable-next-line no-sync
            this.config.key = [fs.readFileSync(output_config.key)];
        }

        this.mqttOutput = null;
    }

    Connect(callback) {
        this.mqttOutput = new mqtt.connect(this._host, this._options);

        let self = this;
        this.mqttOutput.on("offline", function () {
            let message = "Mqtt writer : client connection to " + String(self._host) + " is offline!";
            Sentry.captureMessage(message, Severity.Warning);
            getmainlogger().warn(message);
        });

        this.mqttOutput.on("reconnect", function () {
            let message = "Mqtt writer : client trying to reconnect to " + String(self._host);
            Sentry.captureMessage(message, Severity.Info);
            getmainlogger().debug(message);
        });

        this.mqttOutput.on("connect", function () {
            let message = "Mqtt writer : Connected to " + String(self._host);
            getmainlogger().info(message);
            callback();
        });

        this.mqttOutput.on("error", function (error) {
            Sentry.captureMessage(error, Severity.Error);
            getmainlogger().error("Mqtt writer : Could not connect to ", self._host, " : ", error);
            callback(error);
        });
    }

    Disconnect(callback) {
        let self = this;

        if(self.mqttOutput === null){
            callback(null);
            return;
        }

        self.mqttOutput.end(function (err) {
            if (err) {
                Sentry.captureMessage(err, Severity.Error);
                getmainlogger().error("MQTT writer disconnect failed", err);
                callback(err);
                return;
            }
            callback(null);
        });
    }

    /*
     * callback has signature callback(err, ids_pass, ids_fail)
     */
    Write(docs, callback) {
        let validated_docs = validate_buffer_entry_array(docs);

        if (this.mqttOutput === null) {
            return callback("MQTT output is null!", [], validated_docs.map(entry => entry._id));
        }

        if(!this.mqttOutput.connected){
            return callback(
                "Mqtt client disconnected! Check configuration!", [],
                validated_docs.map(entry => entry._id)
            );
        }

        const async_writes = validated_docs.map(entry => ({entry: entry, mqtt_writer: this }));

        return async.map(
            async_writes,
            MqttWriter._PublishMessage,
            function (error, results) {
                if(error){
                    // unexpected error, let all ids fail
                    return callback(error, [], validated_docs.map(entry => entry._id));
                }

                let ids_success = [];
                let ids_failed = [];

                results.forEach(function (result){
                    if(result.success){
                        ids_success.push(result.entry_id);
                    }
                    else{
                        getmainlogger().error(result.errormessage);
                        ids_failed.push(result.entry_id);
                    }
                });

                getmainlogger().debug(`All MQTT write results Processed. Success : ${ids_success.length}, Failed : ${ids_failed.length}`);

                if(ids_failed.length > 0){
                    return callback(new Error("Some ids failed to publish"), ids_success, ids_failed);
                }
                return callback(null, ids_success, ids_failed);
            }
        );
    }

    static _create_publish_result(success, errormessage, entry){
        return {
            success: success,
            errormessage: errormessage,
            entry_id: entry._id
        };
    }

    /*
     * Callback should have 2 arguments : (error, transformed_item)
     */
    static _PublishMessage(entry_pack, callback) {
        const entry = entry_pack.entry;
        const writer = entry_pack.mqtt_writer;

        BaseWriter.ValidateEntry(entry);

        let topic = String(writer._topic_prefix).concat(entry.output_config);

        if(topic.trim() === ""){
            return callback(null, MqttWriter._create_publish_result(false, "Invalid topic : empty string.", entry));
        }

        if(topic.indexOf("#") > -1){
            return callback(null, MqttWriter._create_publish_result(false, "Invalid topic : contains #.", entry));
        }

        if(topic.indexOf("+") > -1){
            return callback(null, MqttWriter._create_publish_result(false, "Invalid topic : contains +.", entry));
        }

        writer.mqttOutput.publish(
            topic,
            String(entry.timed_value.value),
            writer._options,
            function (err) {
                if (err) {
                    return callback(null, MqttWriter._create_publish_result(false, err, entry));
                }

                return callback(null, MqttWriter._create_publish_result(true, null, entry));
            }
        );

        return null;
    }
}


module.exports = MqttWriter;
