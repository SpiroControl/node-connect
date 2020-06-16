"use strict";

const log4js = require("log4js");

const mainlogger_category = "main";
const writelogger_category = "WritePump";
const readlogger_category = "ReadPump";


const getmainlogger = function () {
    return log4js.getLogger(mainlogger_category);
};

const get_writepump_logger = function () {
    return log4js.getLogger(writelogger_category);
};

const get_readpump_logger = function () {
    return log4js.getLogger(readlogger_category);
};

const ConfigureLogging = function (filename) {
    log4js.configure(filename);
};


module.exports = {
    ConfigureLogging: ConfigureLogging,
    getmainlogger: getmainlogger,
    get_readpump_logger: get_readpump_logger,
    get_writepump_logger: get_writepump_logger
};
