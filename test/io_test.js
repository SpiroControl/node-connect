"use strict";

/* eslint-disable */
const console = require("console");

const path = require("path");

const expect = require("chai").expect;

const ReadPump = require("../readpump");
const WritePump = require("../writepump");

const loadConfig = require("../utils/utils").loadConfigSync;

const opcuaReader = require("../readers/readpump_opcua");
const mqttReader = require("../readers/readpump_mqtt");

const mqttWriter = require("../writers/mqttwriter");
const opcuaWriter = require("../writers/opcuawriter");
const influxdbWriter = require("../writers/influxdbwriter");

const InfluxDB = require("influx").InfluxDB;

const chai = require("chai");
const spies = require("chai-spies");
chai.use(spies);

const sample_opc = require("../exampleconfigs/sample_opcua_server_1");
const sample_opc3 = require("../exampleconfigs/sample_opcua_server_3");

const start_mqtt_mock_server = require("../exampleconfigs/mqtt_mock_server").start_server;
const stop_mqtt_mock_server = require("../exampleconfigs/mqtt_mock_server").stop_server;

const ConfigurationError = require("../utils/errors").ConfigurationError;

const os = require("os");

const mslg = require("../messagelogger");
const BaseWriter = require("../writers/basewriter");

mslg.ConfigureLogging("log4js.json");



/********************************

    TEST HELPER FUCNTIONS

 ********************************/

const getconfig = function(filename){
    const filepath = path.resolve(__dirname, filename);
    return loadConfig(filepath);
};

const create_test_database = function(db_name)
{
    return new Promise(function(resolve, reject) {
        const db = new InfluxDB({host: "influxdb", database: db_name});
        db.getDatabaseNames().then(
            function resolve_names(names) {
                if (!names.includes(db_name)) {
                    db.createDatabase(db_name).then(
                        function resolved() {
                            resolve();
                        },
                        function rejected(error) {
                            reject(error);
                        }
                    );
                }
                else {
                    resolve();
                }
            },
            function reject_names(error){
                reject(error);
            }
        );
    });
};


const clone_config = function (config) {
    return JSON.parse(JSON.stringify(config));
};


const create_data_point = function (ts, value_is_null=false) {
    return {
        node: {
            out_influx: "influx_dp",
            out_opcua: "opcua_out_topic",
            out_mqtt: "mqtt_config",
            dataType: "float",
            calc: null,
            use_calc: false
        },
        value: value_is_null === true?null:Math.random(),
        timestamp: ts?ts:null
    };
};


const create_data_points = function (number_of_points, create_null_ts=false, create_null_values=false, create_null_values_every=10) {
    const points = [];
    const start_time_ms = ((new Date()).getTime() /1000) *1000;

    let point_number;
    for(point_number of Array(number_of_points).keys()) {
        // generate a point every 1 second
        let ts = start_time_ms - ((number_of_points - point_number) * 1000);
        if(create_null_values && point_number % create_null_values_every === 0){
            let data_point = create_data_point(create_null_ts?null:ts, true);
            points.push(data_point);
        }
        else{
            let data_point = create_data_point(create_null_ts?null:ts);
            points.push(data_point);
        }
    }

    return points;
};


const create_fake_measurement = function (){
    return {name: "test_measurement", tags: [
            "test",
            "nodelogger"
        ]};
};


const influx_write_mock = function (points, writeOptions) {
    return new Promise(function (resolve, reject) {
        if (writeOptions === null || writeOptions === undefined) {
            reject("Invalid write options");
        }
        if (points === null || points === undefined) {
            reject("Invalid points");
        }
        if (points.length === 0) {
            reject("No points to write.");
        }
        console.log("Mock-writing ", points.length, " values.");
        resolve();
    });
};


const read_mqtt_reader_config = function(){
    let config = getconfig("./configfile_mqtt_in_readtest.toml");
    config.input.url = config.input.url.replace("localhost", os.hostname());
    const wp = new WritePump(config.output, true);
    return [config, wp];
};


const create_reader_initialize = function(reader_config){
    const rp = new ReadPump(reader_config[0].input, reader_config[0].measurements, reader_config[1]);
    rp.reader.InitializeMeasurements();
};


/*****************************

        ACTUAL TESTS

 *******************************/


describe("ReadPump", function () {
    it("should validate configuration", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");

        const wp = new WritePump(config.output, true);

        expect(function () { new ReadPump(null, config.measurements, wp); }).to.throw(ConfigurationError);
        expect(function () { new ReadPump(config.input, null, wp); }).to.throw(ConfigurationError);
        expect(function () { new ReadPump(config.input, config.measurements, null); }).to.throw(ConfigurationError);

        expect(function () { new ReadPump(undefined, config.measurements, wp); }).to.throw(ConfigurationError);
        expect(function () { new ReadPump(config.input, undefined, wp); }).to.throw(ConfigurationError);
        expect(function () { new ReadPump(config.input, config.measurements, undefined); }).to.throw(ConfigurationError);

        done();
    });

    it("should create mqtt reader type with method Run", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");
        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);
        expect(rp.reader).to.be.an.instanceof(mqttReader);
        expect(rp.reader).to.have.property("Run");

        done();
    });

    it("should create opcua reader type with method Run", function (done) {
        let config = getconfig("./configfile_opcua_in.toml");
        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);
        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(rp.reader).to.have.property("Run");

        done();
    });

    it("should throw error on invalid type", function (done) {
        let config = getconfig("./configfile_opcua_in.toml");
        config.input.type = "randomness....(*)#$";
        const wp = new WritePump(config.output, true);
        const constr_func = function () {
            new ReadPump(config.input, config.measurements, wp);
        };
        expect(constr_func).to.throw(Error);

        done();
    });
});


describe("WritePump", function () {
    it("should validate configuration", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");

        expect(function () { new WritePump(null, true); }).to.throw(ConfigurationError);
        expect(function () { new WritePump(undefined, true); }).to.throw(ConfigurationError);
        const config2 = clone_config(config);

        expect(function () { config2.name = undefined; new WritePump(config2, true); }).to.throw(ConfigurationError);
        expect(function () { config2.name = null; new WritePump(config2, true); }).to.throw(ConfigurationError);
        done();
    });

    it("should create mqtt write type with method Write", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");
        const wp = new WritePump(config.output, true);
        expect(wp.writer).to.be.an.instanceof(mqttWriter);
        expect(wp.writeFunction).to.not.be.null;
        expect(wp.Connect).to.not.be.null;
        done();
    });

    it("should create influx writer type with method Write", function (done) {
        let config = getconfig("./configfile_opcua_in.toml");
        const wp = new WritePump(config.output, true);

        expect(wp.writer).to.be.an.instanceof(influxdbWriter);

        expect(wp.writeFunction).to.not.be.null;
        expect(wp.Connect).to.not.be.null;
        done();
    });

    it("should create opcua writer type with method Write", function (done) {
        let config = getconfig("./configfile_opcua_out.toml");
        const wp = new WritePump(config.output, true);

        expect(wp.writer).to.be.an.instanceof(opcuaWriter);

        expect(wp.writeFunction).to.not.be.null;
        expect(wp.Connect).to.not.be.null;
        done();
    });

    it("should throw error on invalid type", function (done) {
        let config = getconfig("./configfile_opcua_in.toml");
        config.output.type = "randomness..&&@^$#*(%";
        const constr_func = function () {
            new WritePump(config.output, true);
        };
        expect(constr_func).to.throw(Error);

        done();
    });

    it("should succesfully fill the buffer and write to mock", function (done) {
        this.timeout(20000);
        let number_of_test_points = 1000;
        let config = getconfig("./configfile_opcua_in.toml");
        let write_pump = new WritePump(config.output, true);
        chai.spy.on(write_pump.writer._influxOutput, "writePoints", influx_write_mock);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points/2));
        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points/2));

        write_pump.buffer.find({}, function write_to_influx(err, docs) {
            expect(docs).to.have.length(number_of_test_points);
            // noinspection JSUnusedLocalSymbols
            write_pump.writer.Write(docs, function (err_code, ids, ids_failed) {
                expect(err_code).to.be.null;
                expect(ids).to.have.length(number_of_test_points);
                done();
            });
        });
    });

    it("buffer should delete buffer items if going over configured maximum", function (done) {
        let config = getconfig("./configfile_opcua_in.toml");

        let number_of_test_points = 125;
        let buffer_size = 100;
        config.output.bufferMaxSize = buffer_size;

        let write_pump = new WritePump(config.output, true);
        chai.spy.on(write_pump.writer, "writePoints", influx_write_mock);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points));

        write_pump._checkBufferLimit().then(function(numberofdeleteditems){
            expect(numberofdeleteditems).to.be.equal(number_of_test_points - buffer_size);
            write_pump.buffer.find({}, function test_buffer_size(err, docs) {
                expect(docs).to.have.length(buffer_size);
                done();
            });
        }, function(error){
            expect(false).to.be.true(error);
        })
        .catch(function(error) {
            done(error);
        });
    });

    it("Should execute the write cycle multiple times, writing all values", function(done) {
        this.timeout(25000);
        let config = getconfig("./configfile_opcua_in.toml");

        const number_of_test_points = 2000;
        const buffer_size = 2000;
        const number_of_cycles = 40;

        config.output.bufferMaxSize = buffer_size;
        config.output.writeMaxPoints = 50;
        config.output.writeInterval = 100;

        let write_pump = new WritePump(config.output, true);
        chai.spy.on(write_pump.writer._influxOutput, "writePoints", influx_write_mock);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points));

        write_pump.GetNumberOfPointsInBuffer().then(
            function resolve(count){
                expect(count).to.be.eq(number_of_test_points);
            } ,
            function reject(error)
            {
                done(error);
            }
        ).catch(function(error) {
            done(error);
        });

        const cycle = function(i){
            if( i < number_of_cycles) {
                write_pump._exec_write_cycle(function callback(){
                    cycle(i + 1);
                });
            }
            else {
                let nb_points_promise = write_pump.GetNumberOfPointsInBuffer();

                nb_points_promise.then(
                    function resolve(count) {
                        expect(count).to.be.eq(0);
                        done();
                    },
                    function reject(error) {
                        done(error);
                    }
                ).catch(function(error) {
                    done(error);
                }
                );
            }
        };

        cycle(0);
    });


    it("Should execute the write cycle multiple times, writing all values - with empty buffer at end", function(done) {
        this.timeout(25000);
        let config = getconfig("./configfile_opcua_in.toml");

        const number_of_test_points = 1764;
        const buffer_size = 2000;
        const number_of_cycles = 40;

        config.output.bufferMaxSize = buffer_size;
        config.output.writeMaxPoints = 50;
        config.output.writeInterval = 100;

        let write_pump = new WritePump(config.output, true);
        chai.spy.on(write_pump.writer._influxOutput, "writePoints", influx_write_mock);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points));

        write_pump.GetNumberOfPointsInBuffer().then(
            function resolve(count){
                expect(count).to.be.eq(number_of_test_points);
            } ,
            function reject(error)
            {
                done(error);
            }
        ).catch(function(error) {
            done(error);
        });

        const cycle = function(i){
            if( i < number_of_cycles) {
                write_pump._exec_write_cycle(function callback(){
                    cycle(i + 1);
                });
            }
            else {
                write_pump.GetNumberOfPointsInBuffer().then(
                    function resolve(count) {
                        expect(count).to.be.eq(0);
                        done();
                    },
                    function reject(error) {
                        done(error);
                    }
                ).catch(function(error) {
                    done(error);
                });
            }
        };

        cycle(0);
    });
});


describe("Influxwriter", function () {
    it("should throw error on invalid output configuration", function () {
        const configfile = "./configfile_opcua_in.toml";
        let config = getconfig(configfile);

        expect(function(){ new influxdbWriter(config.output); }).to.not.throw(Error);
        expect(function(){ new influxdbWriter(config); }).to.throw(ConfigurationError);

        config = getconfig(configfile);
        config.output.host = null;
        expect(function(){ new influxdbWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(configfile);
        config.output.database = null;
        expect(function(){ new influxdbWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(configfile);
        delete config.output.host;
        expect(function(){ new influxdbWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(configfile);
        delete config.output.database;
        expect(function(){ new influxdbWriter(config.output); }).to.throw(ConfigurationError);
    });

    it("empty input should call function without error", function (done) {
        let wp = new influxdbWriter(getconfig("./configfile_opcua_in.toml").output);

        wp.Write([], function (err, ids, ids_fail){
            expect(err).to.be.null;
            expect(ids).to.have.length(0);
            expect(ids_fail).to.have.length(0);
            if(err){
                done(err);
            }
            done();
        });
    });

    it("should be able to write multiple values to influxdb", function (done) {
        let number_of_test_points = 123;
        let config = getconfig("./configfile_opcua_in.toml");

        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(influxdbWriter);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points, false));

        const promise = create_test_database(config.output.database);
        promise.then(
            function resolve(){},
            function reject(error){
                done("Unable to create test database : " + error);
            })
        .catch(function(error) {
            done(error);
        });

        write_pump.buffer.find({}, function write_to_influx(err, docs) {
            if(err){
                return done(err);
            }
            expect(docs).to.have.length(number_of_test_points);
            write_pump.writer.Connect(function (err) {
                if (err) {
                    return done(err);
                }
                else {
                    write_pump.writer.Write(docs, function (err_code, ids, ids_fail) {
                        expect(err_code).to.be.null;
                        expect(ids).to.have.length(number_of_test_points);
                        expect(ids_fail).to.have.length(0);
                        if (err_code) {
                            return done(err_code);
                        } else {
                            return done();
                        }
                    });
                }
            });
        });
    });

    it("should be able to write multiple values to influxdb, specifying a retention policy", function (done) {
        let number_of_test_points = 123;
        let config = getconfig("./configfile_influx_rp.toml");

        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(influxdbWriter);
        expect(write_pump.writer._writeOptions).to.have.property("retentionPolicy");
        expect(write_pump.writer._writeOptions.retentionPolicy).to.equal("autogen");

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points, false));

        const promise = create_test_database(config.output.database);
        promise.then(
            function resolve(){},
            function reject(error){
                done("Unable to create test database : " + error);
            })
        .catch(function(error) {
            done(error);
        });

        write_pump.buffer.find({}, function write_to_influx(err, docs) {
            if(err){
                return done(err);
            }
            expect(docs).to.have.length(number_of_test_points);
            write_pump.writer.Connect(function (err) {
                if (err) {
                    return done(err);
                }
                else {
                    write_pump.writer.Write(docs, function (err_code, ids, ids_fail) {
                        expect(err_code).to.be.null;
                        expect(ids).to.have.length(number_of_test_points);
                        expect(ids_fail).to.have.length(0);
                        if (err_code) {
                            return done(err_code);
                        } else {
                            return done();
                        }
                    });
                }
            });
        });
    });
});


describe("MqttWriter", function () {
    it("should throw error on invalid output configuration", function () {
        const config_file = "./configfile_mqtt_in.toml";
        let config = getconfig(config_file);

        expect(function(){ new mqttWriter(config.output); }).to.not.throw(Error);
        expect(function(){ new mqttWriter(config); }).to.throw(ConfigurationError);

        config = getconfig(config_file);
        config.output.topicPrefix = null;
        expect(function(){ new mqttWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(config_file);
        config.output.topicPrefix = " ";
        expect(function(){ new mqttWriter(config.output); }).to.not.throw(ConfigurationError);

        config = getconfig(config_file);
        config.output.url = null;
        expect(function(){ new mqttWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(config_file);
        delete config.output.url;
        expect(function(){ new mqttWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig(config_file);
        config.output.url = " ";
        expect(function(){ new mqttWriter(config.output); }).to.throw(ConfigurationError);
    });

    it("should be able to write multiple values to MQTT broker", function (done) {
        let number_of_test_points = 123;
        let config = getconfig("./configfile_mqtt_in.toml");

        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(mqttWriter);

        write_pump.AddPointsToBuffer(create_fake_measurement(), create_data_points(number_of_test_points, false));

        write_pump.buffer.find({}, function write_to_mqtt(err, docs) {
            if(err){
                return done(err);
            }
            expect(docs).to.have.length(number_of_test_points);
            write_pump.writer.Connect(function (err) {
                if (err) {
                    return done(err);
                }
                else {
                    write_pump.writer.Write(docs, function (err_code, ids, ids_fail) {
                        expect(err_code).to.be.null;
                        expect(ids).to.have.length(number_of_test_points);
                        expect(ids_fail).to.have.length(0);
                        write_pump.writer.Disconnect(
                            function(){
                                        if (err_code) {
                                            return done(err_code);
                                        } else {
                                            return done();
                                        }
                            }
                        );
                    });
                }
            });
        });
    });

    it("should fail to write incorrect topics to MQTT broker", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");
        const number_of_points = 2;

        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(mqttWriter);

        let data_point = create_data_point(((new Date()).getTime() /1000) *1000);
        data_point.node.out_mqtt = "hou#";

        let data_point2 = create_data_point(((new Date()).getTime() /1000) *1000);
        data_point2.node.out_mqtt = "hou+";

        write_pump.AddPointsToBuffer(create_fake_measurement(), [data_point, data_point2]);

        write_pump.buffer.find({}, function write_to_influx(err, docs) {
            if(err){
                return done(err);
            }
            expect(docs).to.have.length(number_of_points);

            write_pump.writer.Connect(function (err) {
                if (err) {
                    return done(err);
                }
                else {
                    write_pump.writer.Write(docs, function (err_code, ids, ids_fail) {
                        expect(err_code).not.to.be.null;
                        expect(ids_fail).to.have.length(number_of_points);
                        expect(ids).to.have.length(0);

                        write_pump.writer.Disconnect(function () {
                            if (err_code) {
                                return done();
                            } else {
                                return done("We expected an error code");
                            }
                        });
                    });
                }
            });
        });
    });

    it("should fail to write incorrect topics to MQTT broker and remove from buffer", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");
        config.output.dropOnFailWrite = true;
        config.output.writeInterval = 100;
        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(mqttWriter);

        let data_point = create_data_point(((new Date()).getTime() / 1000) * 1000);
        data_point.node.out_mqtt = "hou#";

        let data_point2 = create_data_point(((new Date()).getTime() / 1000) * 1000);
        data_point2.node.out_mqtt = "hou+";

        write_pump.AddPointsToBuffer(create_fake_measurement(), [data_point, data_point2]);

        write_pump.writer.Connect(function (err) {
            if (err) {
                return done(err);
            }
            write_pump._exec_write_cycle(function () {
                write_pump.buffer.count({}, function (err, count) {
                    expect(count).to.be.equal(0);

                });
                write_pump.writer.Disconnect(function () {

                    return done();
                });

            });
        });
        setTimeout(function () { }, 10000);
    });


    it("should raise exception trying to write empty string topic to MQTT broker", function (done) {
        let config = getconfig("./configfile_mqtt_in.toml");
        let write_pump = new WritePump(config.output, true);
        expect(write_pump.writer).to.be.instanceOf(mqttWriter);

        let data_point3 = create_data_point(((new Date()).getTime() /1000) *1000);
        data_point3.node.out_mqtt = " ";

        const number_of_points = 1;
        write_pump.AddPointsToBuffer(create_fake_measurement(), [data_point3]);

        write_pump.buffer.find({}, function write_to_influx(err, docs) {
            if(err){
                return done(err);
            }
            expect(docs).to.have.length(number_of_points);

            write_pump.writer.Connect(
                function (err){
                    if(err){
                        done(err);
                    }
                    else{
                        expect(function (){write_pump.writer.Write(docs, function (err_code, ids, ids_fail) {});}).to.throw(ConfigurationError);
                        write_pump.writer.Disconnect(function(err){
                            done(err);
                        }
                        );
                    }
                });
        });
    });
});


describe("BaseWriter", function () {
    it(" should validate entry", function () {
        expect(function(){ BaseWriter.ValidateEntry(null); }).to.throw(ConfigurationError);
        expect(function(){ BaseWriter.ValidateEntry(undefined); }).to.throw(ConfigurationError);
        let entry = {};
        expect(function(){ BaseWriter.ValidateEntry(entry); }).to.throw(ConfigurationError);

        entry = {
            output_config : " test "
        };

        expect(function(){ BaseWriter.ValidateEntry(entry); }).to.not.throw(ConfigurationError);

        entry = {
            output_config : " "
        };

        expect(function(){ BaseWriter.ValidateEntry(entry); }).to.throw(ConfigurationError);
    });
});


describe("OPCUA reader/writer", function() {
    before(function(done) {
        sample_opc.start_server().then(
            function resolved(){
                done();
                },
            function rejected(err){
                done(err);
            })
        .catch(function(error) {
            done(error);
        });
    });

    after(function(done) {
        sample_opc.stop_server().then(
            function resolved(){
                done();
                },
            function rejected(err){
                done(err);
            })
        .catch(function(error) {
            done(error);
        });
    });

    it("reader should throw error on invalid input configuration", function () {
        const config_file = "./configfile_opcua_in.toml";
        let config = getconfig(config_file);
        const wp = new WritePump(config.output, true);
        // validate default case : should process without error.
        expect(function(){ new opcuaReader(config.input, config.measurements, wp ); }).to.not.throw(Error);


        expect(function(){ new opcuaReader(config, config.measurements, wp ); }).to.throw(Error);
        expect(function(){ new opcuaReader(config.input, config.measurements, null ); }).to.throw(Error);
        expect(function(){ new opcuaReader(config.input, null, wp ); }).to.throw(Error);
        expect(function(){ new opcuaReader(null, config.measurements, wp ); }).to.throw(Error);

        config = getconfig(config_file);
        config.input.type = "OPCUA";
        expect(function(){ new opcuaReader(config.input, config.measurements, wp ); }).to.throw(Error);
    });

    it("reader should read values using monitoring", function (done){
        this.timeout(10000);

        let config = getconfig("./configfile_opcua_in.toml");

        config.input.url = config.input.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(wp.writer).to.be.an.instanceof(influxdbWriter);
        expect(rp.reader).to.have.property("Run");

        let number_of_reads = 0;
        chai.spy.on(rp.reader, "UpdatePointLastData", function (point){
            expect(point.value).to.not.be.NaN;
            number_of_reads = number_of_reads + 1;
            console.log("Reading OPCUA Value!");
        });

        rp.reader.InitializeMeasurements();
        rp.reader.InitReader(function (err) {
            if (err) {
                done(err);
            }
            else {
                // start reading
                rp.reader.readerMonitoringFunction(function (err) {
                    if(err) {
                        console.log("Reader monitoring function error : ", err);
                    }
                });

                const checkReads = function checkReads() {
                    console.log("Checking number of OPCUA reads in monitoring mode : ", number_of_reads);
                    if (number_of_reads >= 2) {
                        console.log("Reading OPCUA Value at least 2 time - OK!");

                        rp.reader.readerDisconnectFunction(function (err) {
                            if (err) {
                                done(err);
                            }
                            else {
                                console.log("Test done.");
                                done();
                            }
                        });
                    }
                    else{
                        setTimeout(checkReads, 1000);
                    }
                };

                setTimeout(checkReads, 1000);
            }
        });
    });

    it("reader should read values using polling", function (done){
        this.timeout(10000);

        let config = getconfig("./configfile_opcua_in_polled.toml");

        config.input.url = config.input.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(wp.writer).to.be.an.instanceof(influxdbWriter);
        expect(rp.reader).to.have.property("Run");

        let number_of_reads = 0;
        chai.spy.on(rp.reader, "UpdatePointLastData", function (point){
            expect(point.value).to.not.be.NaN;
            number_of_reads = number_of_reads + 1;
            console.log("Reading OPCUA Value!");
        });

        rp.reader.InitializeMeasurements();
        rp.reader.InitReader(function (err) {
            if (err) {
                done(err);
            }
            else {
                // start reading
                rp.reader.readerPollingFunction(function (err) {
                    if(err) {
                        console.log("Reader monitoring function error : ", err);
                    }
                });

                const checkReads = function checkReads() {
                    console.log("Checking number of OPCUA reads in polling mode : ", number_of_reads);
                    if (number_of_reads >= 5) {
                        console.log("Reading OPCUA Value at least 5 time - OK!");

                        rp.reader.readerDisconnectFunction(function (err) {
                            if (err) {
                                done(err);
                            }
                            else {
                                console.log("Test done.");
                                done();
                            }
                        });
                    }
                    else{
                        setTimeout(checkReads, 750);
                    }
                };

                setTimeout(checkReads, 750);
            }
        });
    });

    it("writer should throw error on invalid output configuration", function () {
        let config = getconfig("./configfile_opcua_out.toml");

        expect(function(){ new opcuaWriter(config.output); }).to.not.throw(Error);
        expect(function(){ new opcuaWriter(config); }).to.throw(ConfigurationError);

        config = getconfig("./configfile_opcua_out.toml");
        config.output.url = null;
        expect(function(){ new opcuaWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig("./configfile_opcua_out.toml");
        delete config.output.url;
        expect(function(){ new opcuaWriter(config.output); }).to.throw(ConfigurationError);

        config = getconfig("./configfile_opcua_out.toml");
        config.output.url = " ";
        expect(function(){ new opcuaWriter(config.output); }).to.throw(ConfigurationError);
    });


    it("writer should fail to write OPC values", function (done) {
        this.timeout(25000);

        let config = getconfig("./configfile_opcua_out.toml");
        const number_of_test_points_expected = 15;

        config.input.url = config.input.url.replace("localhost", os.hostname());
        config.output.url = config.output.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(wp.writer).to.be.an.instanceof(opcuaWriter);
        expect(rp.reader).to.have.property("Run");

        wp.writer.Connect(function (err) {
            if(!err) {
                // init reader
                rp.reader.InitializeMeasurements();
                rp.reader.InitReader(function (err) {
                    if (!err) {
                        // start polling
                        rp.reader.readerPollingFunction(function (err) {
                            if (err) {
                                console.log("reader polling function stopped with error " + err);
                            }
                        });
                    }
                });
            }
        });

        const check_number_of_buffer_items = function(){
            wp.buffer.count({}, function (err, count) {
                console.log("Number of total items in buffer : ", count, "/", number_of_test_points_expected);
                if(count < number_of_test_points_expected){
                    setTimeout(check_number_of_buffer_items, 1000);
                }
                else{
                    wp.buffer.find({}, function write_to_opcua(err, docs) {
                        expect(err).to.be.null;
                        expect(docs.length).to.be.greaterThan(number_of_test_points_expected);

                        wp.writer.Write(docs, function (err_code, written_ids, failed_ids) {
                            expect(err_code).to.be.null;
                            // This opc server does not have the write tags defined, so it wont be able to write
                            expect(failed_ids).to.have.length(docs.length);
                            expect(written_ids).to.have.length(0);

                            wp.writer.DisconnectOPCUA(function (err_disco_writer) {
                                if(err_disco_writer){
                                    console.log("Error disconnecting writer : ", err_disco_writer);
                                }
                                rp.reader.DisconnectOPCUA(function (err_disco_reader) {
                                    if(err_disco_reader){
                                        console.log("Error disconnecting writer : ", err_disco_writer);
                                    }
                                    if (err_code) {
                                        return done(err_code);
                                    }

                                    return done();
                                });
                            });
                        });
                    });
                }
            });
        };

        setTimeout(check_number_of_buffer_items, 1000);
    });

    it("writer should fail to write OPC values and remove from buffer", function (done) {
        //same as fail to write OPC values test, but with teh config setting dropOnFailWrite
        //which means the buffer shoud be empty after fail
        this.timeout(25000);
        const sleep_seconds = 10; // sleep 10 seconds to fill write buffer.

        let config = getconfig("./configfile_opcua_out.toml");
        config.output.dropOnFailWrite = true;
        const number_of_test_points_expected = 13;

        config.input.url = config.input.url.replace("localhost", os.hostname());
        config.output.url = config.output.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(wp.writer).to.be.an.instanceof(opcuaWriter);
        expect(rp.reader).to.have.property("Run");

        wp.writer.Connect(function (err) {
            if (!err) {
                // init reader
                rp.reader.InitializeMeasurements();
                rp.reader.InitReader(function (err) {
                    if (!err) {
                        // start polling
                        rp.reader.readerPollingFunction(function (err) {
                            if (err) {
                                return done(err);
                            }
                        });
                    }
                });
            }
        });

        // manual writepump run, wait 10 seconds
        let sleep_counter = 0;

        const check_number_of_buffer_items = function () {
            wp.buffer.count({}, function (err, count) {
                console.log("Number of total items in buffer : ", count);
            });

            sleep_counter = sleep_counter + 1;

            if (sleep_counter < sleep_seconds) {
                setTimeout(check_number_of_buffer_items, 1000);
            }
            else {
                rp.reader.DisconnectOPCUA(function (err1) {
                    if (err1) {
                        return done(err1);
                    }
                    wp.buffer.find({}, function write_to_opcua(err, docs) {
                        expect(err).to.be.null;
                        expect(docs.length).to.be.greaterThan(number_of_test_points_expected);

                        wp._exec_write_cycle(function () {


                            setTimeout(function () { }, 2000);
                            wp.buffer.count({}, function (err, count) {
                                expect(count).to.be.equal(0);

                            });
                            wp.writer.DisconnectOPCUA(function () {
                                return done();

                            });

                        });
                    });
                });
            }
        };

        setTimeout(check_number_of_buffer_items, 1000);
    });
});

describe("OPCUA writer successful write", function () {
    before(function (done) {
        sample_opc3.start_server().then(
            function resolved() {
                done();
            },
            function rejected(err) {
                done(err);
            })
            .catch(function (error) {
                done(error);
            });
    });

    after(function (done) {
        sample_opc3.stop_server().then(
            function resolved() {
                done();
            },
            function rejected(err) {
                done(err);
            })
            .catch(function (error) {
                done(error);
            });
    });

    it("writer should successfully write OPC ", function (done) {
        this.timeout(25000);
        const sleep_seconds = 10; // sleep 10 seconds to fill write buffer.

        let config = getconfig("./configfile_opcua_out.toml");
        config.dropOnFailWrite = true;
        const number_of_test_points_expected = 13;

        config.input.url = config.input.url.replace("localhost", os.hostname());
        config.output.url = config.output.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(opcuaReader);
        expect(wp.writer).to.be.an.instanceof(opcuaWriter);
        expect(rp.reader).to.have.property("Run");

        wp.writer.Connect(function (err) {
            if (!err) {
                // init reader
                rp.reader.InitializeMeasurements();
                rp.reader.InitReader(function (err) {
                    if (!err) {
                        // start polling
                        rp.reader.readerPollingFunction(function (err) {
                            if (err) {
                                return done(err);
                            }
                        });
                    }
                });
            }
        });

        // manual writepump run, wait 10 seconds
        let sleep_counter = 0;

        const check_number_of_buffer_items = function () {
            wp.buffer.count({}, function (err, count) {
                console.log("Number of total items in buffer : ", count);
            });

            sleep_counter = sleep_counter + 1;

            if (sleep_counter < sleep_seconds) {
                setTimeout(check_number_of_buffer_items, 1000);
            }
            else {
                wp.buffer.find({}, function write_to_opcua(err, docs) {
                    expect(err).to.be.null;
                    expect(docs.length).to.be.greaterThan(number_of_test_points_expected);

                    wp.writer.Write(docs, function (err_code, written_ids, failed_ids) {
                        expect(err_code).to.be.null;
                        expect(written_ids).to.have.length(docs.length);
                        expect(failed_ids).to.have.length(0);

                        wp.writer.DisconnectOPCUA(function () {
                            rp.reader.DisconnectOPCUA(function () {
                                if (err_code) {
                                    return done(err_code);
                                }
                                return done();
                            });
                        });
                    });
                });
            }
        };

        setTimeout(check_number_of_buffer_items, 1000);
    });
});
const mqtt_test_topics = [
    "mqtttest/testtopic/Airco1/in/PV", "mqtttest/testtopic/Airco1/in/OP",
    "mqtttest/testtopic/Airco1/in/SP", "mqtttest/testtopic/Airco1/out/CV",
    "mqtttest/testtopic/Airco1/out/CV2"
];

describe("MQTT reader", function() {
    before(function () {
        let config = read_mqtt_reader_config();
        let host_url = config[0].input.url;
        start_mqtt_mock_server(host_url, mqtt_test_topics);
    });

    after(function () {
        stop_mqtt_mock_server();
    });

    it("should validate configuration", function () {
        let config = getconfig("./configfile_mqtt_in_readtest.toml");

        config.input.url = config.input.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        // validate correct configured :
        rp.reader.InitializeMeasurements();
    });

    it("should thow configuration error when measurement name is null", function () {
        const test_init = function () {
                let config = read_mqtt_reader_config();
                config[0].measurements[0].name = null;
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when name is not a property", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                delete config[0].measurements[0].name;
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when name is an empty string ", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                config[0].measurements[0].name = " ";
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when dataType is null", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                config[0].measurements[0].dataType = null;
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when link in_mqtt is missing", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                delete config[0].measurements[0].link[0].in_mqtt;
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when link in_mqtt is null", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                config[0].measurements[0].link[0].in_mqtt = null;
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should thow configuration error when in_mqtt is empty string", function () {
        const test_init =function () {
                let config = read_mqtt_reader_config();
                config[0].measurements[0].link[0].in_mqtt = " ";
                create_reader_initialize(config);
            };
        expect(test_init).to.throw(ConfigurationError);
    });

    it("should read values", function (done) {
        this.timeout(20000);
        const number_of_updates_expected = 12;
        const number_of_test_topics = mqtt_test_topics.length;

        let config = getconfig("./configfile_mqtt_in_readtest.toml");

        config.input.url = config.input.url.replace("localhost", os.hostname());

        const wp = new WritePump(config.output, true);
        const rp = new ReadPump(config.input, config.measurements, wp);

        expect(rp.reader).to.be.an.instanceof(mqttReader);
        expect(wp.writer).to.be.an.instanceof(influxdbWriter);
        expect(rp.reader).to.have.property("Run");

        let number_of_reads_counted = {};
        mqtt_test_topics.forEach(function (test_topic){
                number_of_reads_counted[test_topic] = 0;
        }
        );

        chai.spy.on(rp.reader, "UpdatePointLastData", function (point) {
            expect(point.value).to.not.be.NaN;
            for (const [key, value] of Object.entries(number_of_reads_counted)) {
                let topicstring = config.input.topicPrefix + point.node.topic;
                if(key === topicstring){
                    number_of_reads_counted[key] = value + 1;
                }
            }
        });

        rp.reader.Run(function (err){});

        const checkReads = function checkReads() {
            let read_check = 0;

            for (const [key, value] of Object.entries(number_of_reads_counted)) {
                if (value > number_of_updates_expected) {
                    read_check = read_check + 1;
                    console.log(key, " has ", value, " writes. " +
                        "OK! Reached expected number or reads (", number_of_updates_expected, ")");
                } else {
                    console.log(key, " has ", value, " writes.")
                }
            }

            if (read_check >= number_of_test_topics) {
                console.log("Reading all MQTT topics at least ", number_of_updates_expected, " times - OK!");

                rp.reader.DisconnectMqtt(function (err) {
                    if (err) {
                        return done(err);
                    } else {
                        return done();
                    }
                });
            } else {
                setTimeout(checkReads, 1000);
            }
        };

        setTimeout(checkReads, 1000);
    });
});
