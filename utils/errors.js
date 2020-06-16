"use strict";


class ConfigurationError extends Error{
    constructor(message){
        // noinspection JSCheckFunctionSignatures
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports.ConfigurationError = ConfigurationError;
