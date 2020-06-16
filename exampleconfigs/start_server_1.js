"use strict";

const console = require("console");
const sample_opc = require("../exampleconfigs/sample_opcua_server_1");

sample_opc.start_server().then(
    function resolved(){ console.info("OPC Server 1 started."); },
    function rejected(err){ console.error("Starting OPC server failed with error ", err);
    }
);
