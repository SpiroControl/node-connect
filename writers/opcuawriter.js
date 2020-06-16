"use strict";

const validate_buffer_entry_array = require("../data_validators").validate_buffer_entry_array;

const getmainlogger = require("../messagelogger").getmainlogger;
const OpcuaConnect = require("../opcua_connect");
const opcua = require("node-opcua");
const BaseWriter = require("./basewriter");
const Sentry = require("@sentry/node");
const Severity = require("@sentry/types").Severity;


function get_opc_data_type(doc) {
    let ty = null;

    if (typeof doc.timed_value.value === "number")
        ty = opcua.DataType.Double;

    if (typeof doc.timed_value.value === "string")
        ty = opcua.DataType.String;

    if (typeof doc.timed_value.value === "boolean")
        ty = opcua.DataType.Boolean;

    return ty;
}

class OpcuaWriter extends BaseWriter{
    constructor(output_config) {
        super(output_config);
        this._opcua_client = new OpcuaConnect(output_config, "node-connect-writer");
    }

    Connect(callback){
        let self = this;
        self._opcua_client.ConnectOPCUA(callback);
        self._opcua_client.uaClient.on("close", function (err) {
            // opcua client connection closed, after retrying x times.
            callback(err, 0);
        });
    }

    DisconnectOPCUA(callback){
        this._opcua_client.DisconnectOPCUA(callback);
    }

    // Does not publish the time field
    Write(docs, callback) {
        let validated_docs = validate_buffer_entry_array(docs);
        let points = [];
        let ids = [];

        validated_docs.forEach(function (entry) {
            BaseWriter.ValidateEntry(entry);

            let ty = get_opc_data_type(entry);

            if(ty === null){
                getmainlogger().error("Unsupported datatype for buffer entry : ", entry);
                Sentry.captureMessage(
                    "Unsupported datatype for buffer entry : " + String(entry),
                    Severity.Error
                );
                return;
            }

            points.push({
                nodeId: entry.output_config,
                attributeId: opcua.AttributeIds.Value,
                value: {
                    value: {
                        dataType: ty,
                        value: entry.timed_value.value
                    }
                }
            });

            ids.push(entry._id);
        });

        if (points.length <= 0) {
            return callback(null, [], []);
        }
        if (this._opcua_client.uaSession === null) {
            return callback("OPCUA Session not yet constructed - not writing values", [], ids);
        }

        try {
            getmainlogger().debug("About to write", points.length, " points using opcua.");
            this._opcua_client.uaSession.write(points, function (err, statusCodes) {
                let ids_pass = [];
                let ids_fail = [];
                if (err) {
                    getmainlogger().debug("Error code from OPC writer:", err);
                    return callback(err, [], ids);
                }
                // filter the results. Check for deadband. If all checks pass, set the measurement's lastValue
                statusCodes.forEach(function (s, i) {
                    if (s.value !== 0) {
                        getmainlogger().debug("Write failed with status name:", s.name, " for node : ", points[i].nodeId);
                        ids_fail.push(ids[i]);
                    }
                    else {
                        ids_pass.push(ids[i]);
                    }
                });
                return callback(null, ids_pass, ids_fail);
            });
        }
        catch (e) {
            Sentry.captureException(e);
            return callback(e, [], ids);
        }

        return null;
    }
}


module.exports = OpcuaWriter;
