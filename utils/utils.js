"use strict";

const Sentry = require("@sentry/node");
const toml = require("toml");
const fs = require("fs");
const mslg = require("../messagelogger");
const ConfigurationError = require("./errors").ConfigurationError;
const concat = require("concat-stream");
const pjson = require("../package.json");


function loadConfig(tomlpath) {
    mslg.getmainlogger().info("Reading node-connect configuration from file " + String(tomlpath));

    return new Promise((resolve) =>
    {
        fs.createReadStream(tomlpath, "utf8").pipe(concat(function(data) {
            let parsed = toml.parse(data);
            mslg.getmainlogger().info("Finished reading node-connect configuration from file " + String(tomlpath));
            resolve(parsed);
        }));
    });
}

function loadConfigSync(tomlpath) {
    mslg.getmainlogger().info("(Deprecated) Reading node-connect configuration from file " + tomlpath);
    // eslint-disable-next-line no-sync
    return toml.parse(fs.readFileSync(tomlpath, "utf8"));
}

const INPUT_TYPES = {
    OPCUA: "opcua",
    MQTT: "mqtt"
};

const OUTPUT_TYPES = {
    OPCUA: "opcua",
    MQTT: "mqtt",
    INFLUXDB: "influxdb"
};

const DATA_TYPES = {
    NUMBER: "number",
    STRING: "string",
    BOOLEAN: "boolean"
};


const OPC_COLLECTION_TYPES = {
    POLLED: "polled",
    MONITORED: "monitored"
};

const SUPPORTED_DATA_TYPES = [
    DATA_TYPES.NUMBER,
    DATA_TYPES.STRING,
    DATA_TYPES.BOOLEAN
];

const SUPPORTED_OPC_COLLECTION_TYPES = [
    OPC_COLLECTION_TYPES.POLLED,
    OPC_COLLECTION_TYPES.MONITORED
];


function ValidateConfigurationStringProperty(value, context, validate_empty=true){
    if(value === null || value === undefined){
        throw new ConfigurationError(`${context} : value is null or undefined.`);
    }

    if(validate_empty && value.trim() === ""){
        throw new ConfigurationError(`${context} : value is empty string.`);
    }
}


function ValidateConfigurationProperty(value, context){
    if(value === null || value === undefined){
        throw new ConfigurationError(`${context} : value is null or undefined.`);
    }
}


function LooseParse(calc_function) {
    // eslint-disable-next-line no-new-func
    let f = Function("value", `"use strict"; return(${calc_function});`);
    f(0); // test the function
    return f;
}


function GetOPCUAClientSubscriptionSettings(input_config) {
    return input_config.OPCUA_ClientSubscriptionOptions || {
        requestedPublishingInterval: 0,
        requestedLifetimeCount: 100,
        requestedMaxKeepAliveCount: 1000,
        maxNotificationsPerPublish: 0, // no limit
        publishingEnabled: true,
        priority: 0
    };
}


function GetOPCUAClientSettings(input_config) {
    return input_config.OPCUA_ClientSettings || {
        keepSessionAlive: true,
        endpoint_must_exist: false,
        requestedSessionTimeout: 60 * 60 * 1000, // timeout in ms, one hour
        transportTimeout: 60 * 60 * 1000,
        connectionStrategy: {
            maxRetry: -1, // infinite retry attemps
            initialDelay: 1000, // in milliseconds
            maxDelay: 10000 // in milliseconds
        }
    };
}

function SetupSentry(config) {
    if(config.sentry === null || config.sentry === undefined){
        mslg.getmainlogger().info("[sentry] section not found in configuration file, sentry integration disabled.");
        return;
    }

    if(config.sentry.dsn === null || config.sentry.dsn === undefined){
        mslg.getmainlogger().info("[sentry] section dsn parameter not found in configuration file, sentry integration disabled.");
        return;
    }

    if(config.sentry.environment === null || config.sentry.environment === undefined){
        Sentry.init({
            dsn: config.sentry.dsn,
            release: pjson.version,
            attachStacktrace: true
        });
    }
    else {
        Sentry.init({
            dsn: config.sentry.dsn,
            release: pjson.version,
            environment: config.sentry.environment,
            attachStacktrace: true
        });
    }


    mslg.getmainlogger().info("Sentry integration with dsn " + String(config.sentry.dsn) + " enabled.");
}


module.exports.loadConfig = loadConfig;
module.exports.INPUT_TYPES = INPUT_TYPES;
module.exports.DATA_TYPES = DATA_TYPES;
module.exports.SUPPORTED_DATA_TYPES = SUPPORTED_DATA_TYPES;
module.exports.OUTPUT_TYPES = OUTPUT_TYPES;
module.exports.SUPPORTED_OPC_COLLECTION_TYPES = SUPPORTED_OPC_COLLECTION_TYPES;
module.exports.OPC_COLLECTION_TYPES = OPC_COLLECTION_TYPES;
module.exports.ValidateConfigurationStringProperty = ValidateConfigurationStringProperty;
module.exports.ValidateConfigurationProperty = ValidateConfigurationProperty;
module.exports.LooseParse = LooseParse;
module.exports.GetOPCUAClientSubscriptionSettings = GetOPCUAClientSubscriptionSettings;
module.exports.GetOPCUAClientSettings = GetOPCUAClientSettings;

// eslint-disable-next-line no-sync
module.exports.loadConfigSync = loadConfigSync;

module.exports.SetupSentry = SetupSentry;
