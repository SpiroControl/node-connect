"use strict";

const ReadPump = require("./readpump.js");
const WritePump = require("./writepump.js");
const mslg = require("./messagelogger");
const loadConfig = require("./utils/utils").loadConfig;
const SetupSentry = require("./utils/utils").SetupSentry;
const path = require("path");
const Sentry = require("@sentry/node");

mslg.ConfigureLogging("log4js.json");

let config_file_name = path.resolve(__dirname, "./config.toml");

if (process.argv.length > 2) {
    config_file_name = process.argv[2];
}

let config_promise = loadConfig(config_file_name);
config_promise.then((_config) => {
    mslg.getmainlogger().info("Setup Sentry integration");
    SetupSentry(_config);

    mslg.getmainlogger().info("Start output handles - create writepump");
    let wp = new WritePump(_config.output);

    mslg.getmainlogger().info("Starting WritePump");
    wp.Run();
    mslg.getmainlogger().info("WritePump started");


    mslg.getmainlogger().info("Creating Readpump");
    const rp = new ReadPump(_config.input, _config.measurements, wp);

    mslg.getmainlogger().info("Starting Readpump...");
    rp.Run();
    mslg.getmainlogger().info("...Readpump started.");
}).catch(error => {
    mslg.getmainlogger().error("Error Loading config file : " + String(error));
    Sentry.captureException(error);
    process.exit(2);
});


