"use strict";

const ReadPump = require("./readpump.js");
const WritePump = require("./writepump.js");
const loadConfig = require("./utils/utils").loadConfig;
const mslg = require("./messagelogger");

let config;

if (process.argv.length > 2) {
    config = loadConfig(process.argv[2]);
}
else {
    config = loadConfig("./exampleconfigs/config_test.toml");
}

// configure message logging
mslg.ConfigureLogging("log4js.json");

// start output handles
let wp = new WritePump(config.output);
wp.Run(true);

// get a readpump
const rp = new ReadPump(config.input, config.measurements, wp);
rp.Run(function () { });

setTimeout(process.exit, 15000);
