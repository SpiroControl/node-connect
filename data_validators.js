"use strict";

const optional = require("decoders").optional;
const string = require("decoders").string;
const boolean = require("decoders").boolean;
const number = require("decoders").number;
const guard = require("decoders").guard;
const array = require("decoders").array;
const object = require("decoders").object;
const mixed = require("decoders").mixed;
const either3 = require("decoders").either3;

const timed_value = object({
    // date in ms rounded to the second for storage efficiency
    time: number,
    value: either3(number, string, boolean)
});

const entry = object({
    _id: optional(string), // after being added to the buffer, the entry gets an id after retrieval
    measurement_name: string,
    timed_value: timed_value,
    tags: mixed,
    output_config: mixed,
    i: number
});

const node = object({
    nodeId: optional(mixed),
    topic: optional(mixed),

    out_influx: optional(string),
    out_opcua: optional(string),
    out_mqtt: optional(string),

    dataType: string,

    calc: mixed,
    use_calc: boolean,

    attributeId: optional(mixed)
});

const read_point = object({
    node: node,
    value: either3(number, boolean, string),
    timestamp: number,
    // optional OPC properties
    opcstatus: optional(string)
});

const entry_array = array(entry);
const point_array = array(read_point);

// Guards
const entry_decoder = guard(entry);
const entry_array_decoder = guard(entry_array);
const point_array_decoder = guard(point_array);

function validate_buffer_entry(buffer_entry){
    return entry_decoder(buffer_entry);
}

function validate_buffer_entry_array(buffer_array){
    return entry_array_decoder(buffer_array);
}

function validate_point_array(point_array){
    return point_array_decoder(point_array);
}

module.exports = {
    validate_buffer_entry: validate_buffer_entry,
    validate_buffer_entry_array: validate_buffer_entry_array,
    validate_point_array: validate_point_array
};