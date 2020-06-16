"use strict";

const opcua = require("node-opcua");
const console = require("console");


const server3 = new opcua.OPCUAServer({
    port: 4334, // the port of the listening socket of the server
    resourcePath: "/SpiroNodeTestOutput", // this path will be added to the endpoint resource name
    buildInfo: {
        productName: "Spiro Control NodeJS OPCUA server",
        buildNumber: "0",
        buildDate: new Date(2018, 9, 17)
    }
});

function construct_my_address_space(server) {
    const addressSpace = server.engine.addressSpace;
    const namespace = addressSpace.getOwnNamespace();

    let variable1 = 1;
    setInterval(function(){
        variable1 = Math.random();
    }, 500);

    const airco_device = namespace.addObject({
        organizedBy: addressSpace.rootFolder.objects,
        browseName: "spiro_measurements"
    });

    namespace.addVariable({
        componentOf: airco_device,
        nodeId: "ns=1;s=Airco.Humidity",
        browseName: "Humidity",
        dataType: "Double",
        value: {
            get: function () {
                return new opcua.Variant({dataType: opcua.DataType.Double, value: variable1 });
            },
            set: function (variant) {
                variable1 = parseFloat(variant.value);
                return opcua.StatusCodes.Good;
            }
        }
    });

    let variable2 = 22.0;
    setInterval(function(){
        variable2 = Math.random() + 22.0;
    }, 2000);

    namespace.addVariable({
        componentOf: airco_device,
        nodeId: "ns=1;s=Airco.Temperature",
        browseName: "Temperature",
        dataType: "Double",

        value: {
            get: function () {
                return new opcua.Variant({dataType: opcua.DataType.Double, value: variable2 });
            },
            set: function (variant) {
                variable2 = parseFloat(variant.value);
                return opcua.StatusCodes.Good;
            }
        }
    });

    let variable3 = 22.0;

    namespace.addVariable({
        componentOf: airco_device,
        nodeId: "ns=1;s=Airco.Temperature_Out",
        browseName: "Temperature_Out",
        dataType: "Double",

        value: {
            get: function () {
                return new opcua.Variant({ dataType: opcua.DataType.Double, value: variable3 });
            },
            set: function (variant) {
                variable3 = parseFloat(variant.value);
                return opcua.StatusCodes.Good;
            }
        }
    });

    let variable4 = 22.0;

    namespace.addVariable({
        componentOf: airco_device,
        nodeId: "ns=1;s=Airco.Humidity_Out",
        browseName: "Humidity_Out",
        dataType: "Double",

        value: {
            get: function () {
                return new opcua.Variant({ dataType: opcua.DataType.Double, value: variable4 });
            },
            set: function (variant) {
                variable4 = parseFloat(variant.value);
                return opcua.StatusCodes.Good;
            }
        }
    });
}

function log_server_start(server){
    console.log("Server is now listening ... ( press CTRL+C to stop)");
    console.log("port ", server.endpoints[0].port);
    const endpointUrl = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
    console.log(" the primary server endpoint url is ", endpointUrl);
}

function start_server(){
    return new Promise((resolve, reject) => {
        server3.initialize(function () {
            construct_my_address_space(server3);
            server3.start(function (err) {
                if (err) {
                    reject(err);
                }
                else {
                    log_server_start(server3);
                    resolve();
                }
            });
        });
    });
}


function stop_server(timeout=5){
    return new Promise((resolve, reject) => {
        server3.shutdown(timeout, function callback(err) {
            if (err) {
                console.log("Error stopping server : ", err);
                reject(err);
            }
            else
            {
                console.log("Server stopped");
                resolve();
            }
        });
    });
}


module.exports.start_server = start_server;
module.exports.stop_server = stop_server;
