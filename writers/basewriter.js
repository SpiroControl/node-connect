"use strict";

const ConfigurationError = require("../utils/errors").ConfigurationError;

class BaseWriter {
    constructor(output_config) {
        if(output_config === undefined || output_config === null) {
            throw new ConfigurationError("Invalid configuration : output configuration is invalid.");
        }
    }

    static ValidateEntry(entry) {
        if(entry === null || entry === undefined){
            throw new ConfigurationError("Invalid entry : null or undefined");
        }

        if (entry.output_config === null || entry.output_config === undefined) {
            throw new ConfigurationError(`Invalid entry : output_config is null or undefined : ${entry}`);
        }

        if (entry.output_config.trim() === "") {
            throw new ConfigurationError(`Invalid entry : output_config is empty string : ${entry}`);
        }

        return true;
    }
}

module.exports = BaseWriter;
