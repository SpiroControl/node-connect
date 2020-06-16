"use strict";

const nodemon = require("nodemon");
const console = require("console"); // use default console log, configuration of logging setup in logger.js

if (process.argv.length > 2) {
    console.info("Starting monitored spiro-node-logger with file " + String(process.argv[2]));
    nodemon({
        script: "connect.js",
        args: [process.argv[2]]
    });
}
else {
    console.info("Starting monitored spiro-node-logger with default config file");
    nodemon({
        script: "connect.js"
    });
}

nodemon.on("start", function () {
    console.info("Monitored node-connect has started");
}).on("quit", function () {
    console.info("Monitored node-connect has quit");
    process.exit();
}).on("restart", function (files) {
    console.info("Monitored node-connect restarted due to: ", files);
});
