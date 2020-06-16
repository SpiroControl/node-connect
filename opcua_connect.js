"use strict";

const fs = require("fs");

const OPCUAClient = require("node-opcua").OPCUAClient;
const MessageSecurityMode = require("node-opcua").MessageSecurityMode;
const SecurityPolicy = require("node-opcua").SecurityPolicy;
const UserTokenType = require("node-opcua-types").UserTokenType;
const mslg = require("./messagelogger");
const GetOPCUAClientSettings = require("./utils/utils").GetOPCUAClientSettings;

const ValidateConfigurationProperty = require("./utils/utils").ValidateConfigurationProperty;
const ValidateConfigurationStringProperty = require("./utils/utils").ValidateConfigurationStringProperty;

/**
 * opcua base class from which the reader and writer can inherit
 */
class OpcuaConnect {
    constructor(config, client_name) {
        ValidateConfigurationProperty(config, "OpcUA connect invalid config object");
        ValidateConfigurationStringProperty(config.url, "OpcUA connect invalid url config");

        this.config = config;

        this.uaServerUrl = config.url;
        this.username = config.username;
        this.password = config.password;

        this.uaSession = null;
        this.clientSettings = GetOPCUAClientSettings(config);
        if(client_name === undefined || client_name === null){
            client_name = "node-connect";
        }
        this.clientSettings.clientName = client_name;

        // noinspection JSUnresolvedVariable
        if (config.secureConnection) {
            // noinspection JSUnresolvedVariable
            this.clientSettings.securityMode = MessageSecurityMode.SignAndEncrypt;
            this.clientSettings.securityPolicy = SecurityPolicy.Basic256;
            this.clientSettings.certificateFile = config.certificateFile;
            this.clientSettings.privateKeyFile = config.privateKeyFile;
            if (config.serverCertificateFile) {
                // eslint-disable-next-line no-sync
                this.clientSettings.serverCertificate = fs.readFileSync(config.serverCertificateFile);
            }
        }

        this.uaClient = null;
    }

    ConstructNewClient(){
        let uaClient = OPCUAClient.create(this.clientSettings);
        mslg.getmainlogger().debug("OPCUA clientSettings :", this.clientSettings);


        uaClient.on("start_reconnection", function () {
            mslg.getmainlogger().info("OPCUA : start reconnection");
        });

        uaClient.on("connection_reestablished", function () {
            mslg.getmainlogger().info("OPCUA : connection reestablished!");
        });

        uaClient.on("connection_lost", function () {
            mslg.getmainlogger().warn("OPCUA : connection lost!");
        });

        uaClient.on("backoff", function (retry_count, delay) {
            mslg.getmainlogger().warn("OPCUA : connection failed for the", retry_count, " time ... We will retry in ", delay, " ms");
        });

        return uaClient;
    }

    ConnectOPCUA(callback) {
        let self = this;

        this.DisconnectOPCUA(function(err){
            if (err){
                mslg.getmainlogger().warn("Unable to disconnect previous client due to error ", err);
            }
            else{
                self.uaClient = self.ConstructNewClient();

                mslg.getmainlogger().info("Connecting to", self.uaServerUrl);
                self.uaClient.connect(self.uaServerUrl, function (err) {
                    if (err) {
                        mslg.getmainlogger().warn("Could not connect to ", self.uaServerUrl, " : ", err);
                        callback(err);
                        return;
                    }

                    mslg.getmainlogger().info("Connected to endpoint ", self.uaServerUrl);

                    let sessionHandler = function (err, session) {
                        if (err) {
                            callback(err);
                            return;
                        }

                        self.uaSession = session;
                        self.uaSession.on("session_closed", function (e) {
                            if (e) {
                                mslg.getmainlogger().warn("Session close event:", e.description, "session ID is", e.value);
                            }
                            else {
                                mslg.getmainlogger().warn("Session close event");
                            }
                        });

                        mslg.getmainlogger().info("OPCUAConnect : session started.");
                        callback(null);
                    };

                    let endpoint = self.uaClient.findEndpointForSecurity(self.uaClient.securityMode, self.uaClient.securityPolicy);
                    let useAuth = false;
                    if (endpoint.userIdentityTokens && endpoint.userIdentityTokens.length) {
                        endpoint.userIdentityTokens.forEach(function (token) {
                            if (token.policyId === "UserName") {
                                useAuth = true;
                            }
                        });
                    }
                    if (useAuth) {
                        mslg.getmainlogger().info("The endpoint requires username and password");
                        if (!self.username || !self.password) {
                            callback(Error("Please provide username and password to establish a session on the endpoint."));
                            return;
                        }
                        self.uaClient.createSession({
                            type: UserTokenType.UserName,
                            userName: self.username,
                            password: self.password
                        }, sessionHandler);
                    }
                    else {
                        mslg.getmainlogger().info("The endpoint does not require username and password. Establishing anonymous session.");
                        self.uaClient.createSession(
                            {
                                type: UserTokenType.Anonymous
                            },
                            sessionHandler
                        );
                    }
                });
            }
        });
    }

    _disconnect_impl(callback){
        let self = this;

        if (self.uaSession) {
            self.uaSession.close(function (err) {
                if (err) {
                    mslg.getmainlogger().warn("session close failed", err);
                } else {
                    mslg.getmainlogger().info("Session closed. Setting uaSession to null.");
                }
                self.uaSession = null;
                self.DisconnectOPCUA(callback);
            });
        }
        else {
            self.uaClient = null;
            // eslint-disable-next-line callback-return
            callback();
        }
    }

    DisconnectOPCUA(callback) {
        this._disconnect_impl(callback);
    }
}


module.exports = OpcuaConnect;
