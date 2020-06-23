# node-connect

This application transmits data from a source to a destination. A simple file in toml format can be used to configure the entire application with
multiple point to point connections. Each point can have a basic value type of Real, Int, String or Bool.

The data is buffered locally to a file based database so that, if the destination is temporarily unavailable, the data is not lost.

We support the following input connections or "readers": 

- mqtt
- opcua

and the following writers:

- influx
- mqtt
- opcua

Brought to you by [Spiro](http://www.spirocontrol.com/?utm_source=github&utm_medium=social&utm_campaign=node_connect_launch "Spiro Control homepage")

# Build

We package the node-connect application as a docker image. A dockerfile is present in the repository root that is used to build
the image.

The referenced docker hub base image used in the Dockerfile is `node:12-buster`.

The NodeJS version used at the moment is the current *LTS* version `12` (on debian buster) with and end-of-life date of 2022-04-30.
More info on https://nodejs.org/en/about/releases/.

# Installation

## Docker

You can use the docker image  `spirocontrol/node-connect` with one of the following tags:

- `spirocontrol/node-connect:develop` : built from `develop` branch
- `spirocontrol/node-connect:x.x.x` : tagged from tag `x.x.x` in git. Should be used for production install.
- `spirocontrol/node-connect:latest` : built from `master` branch.  Only stable releases should be built on master.

Prepare a configuration file in a folder as described below. It should be named `config.toml`. Mount the folder while starting the
docker container

`docker run -d -v /path/to/config:/home/node/app/configfile spirocontrol/node-connect`

node-connect will run in monitored mode, which means that saved changes to config.toml will take
effect immediately.

## From source

- install nodejs and npm
- `npm install`
- `node monitored_connect.js "/path/to/config.toml" # to run in monitored mode`
- `node connect.js "/path/to/config.toml" # to run fire and forget (loads config.toml once)`

# Dependencies

Most dependencies fix major and minor version number but allow freedom to update to the latest patch version.
This is done by specifying versions with the format `~12.5.0`, which will allow any patch upgrade : `>= 12.5.0` and `< 12.6.0`.
See https://github.com/npm/node-semver for more info.

# Configuration file

The configuration file can contain the following components: 

Optional
- sentry configuration

Required
- input section
- output section
- measurements

These section will be described in the following chapters.

## Sentry

To use sentry, add the following section to the configuration file. Remove the section to disble sentry integration.

```toml
[sentry]
dsn = "http://921a5c80a7534b1ba867467382a7bce1@127.0.0.1:9000/2"
environment = "develop"
```

## Input

### MQTT

```toml
[input]
name = "mqtt"
type = "mqtt"
url = "mqtt://172.22.80.179:1883"
username = ""
password = ""
qos = 0
failoverTimeout = 5 # time to wait (in seconds) before reconnection in case of failure in the run function
topicPrefix = "" # topicPrefix will be prefixed to every mqtt topic in individual input measurements.

# OPTIONAL : 
key = "/home/joris/mosquitto_cert/client2.key" # path to certificate keyfile (client private key)
cert = "/home/joris/mosquitto_cert/client2.crt" # client certificate
ca = "/home/joris/mosquitto_cert/ca.crt" # certificate authority certificate
rejectUnauthorized = true # If set to true invalid certificates will be rejected (for example, when the server hostname does not match the common name in the certificate)
```

### OPCUA

```toml
[input]
name = "opcua"
type = "opcua"
url = "opc.tcp://172.22.57.188:4840"
username = ""
password = ""
secureConnection = false
failoverTimeout = 5 # time to wait (in seconds) before reconnection in case of failure in the run function
```

#### OPCUA ClientSettings

These are optional settings in the case where an OPCUA input defined.

``` toml
[input.OPCUA_ClientSettings]
    keepSessionAlive = true
    endpoint_must_exist = false
    requestedSessionTimeout = 3600000  # timeout in ms, one hour

[input.OPCUA_ClientSettings.connectionStrategy]
     maxRetry = -1 # infinite retry attemps
     initialDelay = 1000 # in milliseconds
     maxDelay = 10000 # in milliseconds
```

#### OPCUA ClientSubscription options
Optional OPCUA client subscription options, only used for OPCUA *Monitoring*, not polling.

```toml
[input.OPCUA_ClientSubscriptionOptions]
    requestedPublishingInterval = 0
    requestedLifetimeCount = 100
    requestedMaxKeepAliveCount = 10
    maxNotificationsPerPublish = 0
    publishingEnabled = true
    priority = 0
```
    
```requestedPublishingInterval```

This interval defines the cyclic rate that the Subscription is being requested to
return Notifications to the Client. This interval is expressed in milliseconds. This
interval is represented by the publishing timer in the Subscription state table.
The negotiated value for this parameter returned in the response is used as the
default sampling interval for MonitoredItems assigned to this Subscription.
If the requested value is 0 or negative, the Server shall revise with the fastest
supported publishing interval.
         
```requestedLifetimeCount```

Requested lifetime count (see 7.5 for Counter definition). The lifetime count shall
be a minimum of three times the keep keep-alive count.
When the publishing timer has expired this number of times without a Publish
request being available to send a NotificationMessage, then the Subscription
shall be deleted by the Server.
         
         
```requestedMaxKeepAliveCount ```

Requested maximum keep-alive count (see 7.5 for Counter definition). When the
publishing timer has expired this number of times without requiring any
NotificationMessage to be sent, the Subscription sends a keep-alive Message to
the Client.
The negotiated value for this parameter is returned in the response.
If the requested value is 0, the Server shall revise with the smallest supported
keep-alive count.
         
         
```maxNotificationsPerPublish```
        
The maximum number of notifications that the Client wishes to receive in a
single Publish response. A value of zero indicates that there is no limit.
The number of notifications per Publish is the sum of monitoredItems in the
DataChangeNotification and events in the EventNotificationList.
         
         
```publishingEnabled```

A Boolean parameter with the following values:
`TRUE` : publishing is enabled for the Subscription.
`FALSE` : publishing is disabled for the Subscription.
The value of this parameter does not affect the value of the monitoring mode
Attribute of MonitoredItems.
     
         
```priority```

Indicates the relative priority of the Subscription. When more than one
Subscription needs to send Notifications, the Server should de-queue a Publish
request to the Subscription with the highest priority number. For Subscriptions
with equal priority the Server should de-queue Publish requests in a round-robin
fashion.
A Client that does not require special priority settings should set this value to
zero.

## Output

### Common output settings

```reportIntervalSeconds``` Set the interval (seconds) as to when the WritePump should report the number of items written per write and average number of items per second.

```writeMaxPoints``` Maximum number of items to write in one write cycle.

```bufferMaxSize``` Max number of items to keep in the local buffer db.

```droponfailwrite``` If true, do not attempt to write values again which failed the first time.

```writeInterval``` How often the write cycle should be triggered, in milliseconds.

```failoverTimeout``` Time to wait before reconnecting in case of a failure.

### InfluxDB

#### Influx over http

Example influx output settings : 

```toml
[output]
name = "influx"             # used to create local database for buffering
type = "influxdb"           # signifies data destination is influx
host = "172.22.161.218"
database = "demo1"          # influx database name
username = "MpcDemo"
password = "*******"
protocol = "http"
writeMaxPoints = 1000       # max points written to destination in one go
failoverTimeout = 10
bufferMaxSize = 10000
writeInterval = 1000        # read from buffer every so many ms and write to destination
retentionPolicy="one_year"  # influx retention policy to write to
```

`retentionPolicy`  : Optional, specify the retention policy to write to.

#### Influx over https

 Add these settings to the above settings: 
```toml
protocol = "https"

[output.RequestOptions]
    rejectUnauthorized = true
    cert = "/home/joris/mosquitto_cert/client2.crt"
    ca = "/home/joris/mosquitto_cert/ca.crt"
    key = "/home/joris/mosquitto_cert/client2.key"
```

### MQTT

#### MQTT without certificates

```toml
[output]
name = "mqtt"
type = "mqtt"
url = "mqtt://172.22.80.179:1883"
username = ""
password = ""
qos = 0           # mqtt quality of service, 0: at most once, 1: At least once, 2: Exactly once
topicPrefix = ""  # topic prefixed to every individual mqtt topic 
failoverTimeout = 5
bufferMaxSize = 10000
writeInterval = 200
dropOnFailWrite = true  # if true then dont try to write again if write failed once
```

#### Mqtt output with certificates

Add the following settings to the default mqtt output settings:
```toml
key = "/home/joris/mosquitto_cert/client2.key"
cert = "/home/joris/mosquitto_cert/client2.crt"
ca = "/home/joris/mosquitto_cert/ca.crt"
rejectUnauthorized = true
```

### OPCUA

```toml
[output]
name = "opcua"
type = "opcua"
url = "opc.tcp://172.22.57.188:4840"
username = ""
password = ""
failoverTimeout = 5
bufferMaxSize = 10000
writeInterval = 200
dropOnFailWrite = true

secureConnection = false
```

#### OPCUA with secure connection

```certificateFile``` client certificate file.

```privateKeyFile``` client private key file.

```certificateFile``` server certificate file.

```toml
[output]
name = "opcua"
type = "opcua"
url = "opc.tcp://172.22.57.188:4840"
username = ""
password = ""
failoverTimeout = 5
bufferMaxSize = 10000
writeInterval = 200
dropOnFailWrite = true

secureConnection = true
serverCertificateFile = "server.crt"
certificateFile = "certificates/uaservercpp.crt" 
privateKeyFile = "certificates/uaservercpp.pem"
```

##### Note: defaults 
Security is set to security mode ```MessageSecurityMode.SignAndEncrypt``` and the security policy is set to ```SecurityPolicy.Basic256```.
These settings cannot be changed from the configuration file at the moment.


# Measurements

For each value you want to log, repeat the following in the config file:

```toml
# A polled node:
[[measurements]]
name               = "Int32polled"
dataType           = "number"|"string"|"boolean"
collectionType     = "polled"
pollRate           = 20     # samples / minute.
deadbandAbsolute   = 0      # Absolute max difference for a value not to be collected
deadbandRelative   = 0.0    # Relative max difference for a value not to be collected

# A monitored node
[[measurements]]
name               = "Int32monitored"
dataType           = "number"|"string"|"boolean"
collectionType     = "monitored"
monitorResolution  = 1000    # ms 
deadbandAbsolute   = 0 		# Absolute max difference for a value not to be collected
deadbandRelative   = 0    	# Relative max difference for a value not to be collected
```

`monitorResolution` : in OPCUA, this is translated into the MonitoringParameter `samplingInterval`, meaning:

> The interval that defines the fastest rate at which the MonitoredItem(s) should be
> accessed and evaluated. This interval is defined in milliseconds.
> The value 0 indicates that the Server should use the fastest practical rate.
> The value -1 indicates that the default sampling interval defined by the publishing
> interval of the Subscription is requested. A different sampling interval is used if the
> publishing interval is not a supported sampling interval. Any negative number is
> interpreted as -1. The sampling interval is not changed if the publishing interval is
> changed by a subsequent call to the ModifySubscription Service.
> The Server uses this parameter to assign the MonitoredItems to a sampling interval
> that it supports.
> The assigned interval is provided in the revisedSamplingInterval parameter. The
> Server shall always return a revisedSamplingInterval that is equal or higher than
> the requested samplingInterval. If the requested samplingInterval is higher than the
> maximum sampling interval supported by the Server, the maximum sampling
> interval is returned.


## Some examples for measurements and links

### Mqtt to influx link

```toml
[[measurements]]
name = "mpc_mv_sig" # influx measurement name
dataType = "number"

# tags that will be added in influx for all the following links
# this tags section is only valid for an influx output
[measurements.tags]
id = "TIC101SV"
spiroApp = "D101"
description = "Sensitive Tray Temp"
units = "degC"
instrument = "TIC101"
parameter = "SV"

[[measurements.link]]
in_mqtt = "mpc/apps/D101/out/mvs/TIC101/uMpc"
out_influx = "uMpc"
```

### OPCUA to Mqtt link

```toml
[[measurements]]
name = "uProcess"
dataType = "number"
collectionType = "polled"
pollRate = 6  # read these many times per minute from opcua

[[measurements.link]]
in_opcua = "ns=4;s=|var|app1.sim_D101.sim1.simdat2.mvs[0].SimProcess"
out_mqtt = "mpc/mvs/TIC101SV/uProcess"
[[measurements.link]]
in_opcua = "ns=4;s=|var|app1.sim_D101.sim1.simdat2.mvs[1].SimProcess"
out_mqtt = "mpc/mvs/FIC101SV/uProcess"
[[measurements.link]]
in_opcua = "ns=4;s=|var|app1.sim_D101.sim1.simdat2.mvs[2].SimProcess"
out_mqtt = "mpc/mvs/FIC101SV/uProcess"
[[measurements.link]]
in_opcua = "ns=4;s=|var|app1.sim_D101.sim1.simdat2.mvs[3].SimProcess"
out_mqtt = "mpc/mvs/FIC101SV/uProcess"
[[measurements.link]]
in_opcua = "ns=4;s=|var|app1.sim_D101.sim1.simdat2.mvs[4].SimProcess"
out_mqtt = "mpc/mvs/LIC101MV/uProcess"
```

# Note: Deprecated settings

- Using ```debugMode``` has no effect at all on any reader or writer.  Remove it from your config files.
- Using ```messageLog``` is not used anymore. All logging is configured using the ```log4js.json``` file. 
- ```retryAttempts``` is not used anymore : replaced by the input or output OPCUA ClientSettings.

# Note: MQTT types
When selecting `Number` for the mqtt measurement link, we are parsing the MQTT message payload as an _ASCII string_
containing the string representation of an integer or float, using `.` as the decimal point.

It cannot contain:

- spaces
- comma

# Acknowledgments

This project was inspired by the node-opcua-logger project on https://github.com/coussej/node-opcua-logger.git 
