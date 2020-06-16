"use strict";

const get_logger = require("./messagelogger").get_writepump_logger;

class WritePumpReporting {
    constructor(reportIntervalMs){
        this._start_time_ms = Date.now();
        this._last_avg_report_time = Date.now();

        this._total_number_of_items_written = 0;
        this._total_number_of_write_cycles = 0;
        this._reportIntervalMs = reportIntervalMs;

        this.Reset();
    }

    Reset(){
        this._start_time_ms = Date.now();
        this._last_avg_report_time = Date.now();

        this._total_number_of_items_written = 0;
        this._total_number_of_write_cycles = 0;
    }

    RegisterWriteCycle(){
        this._total_number_of_write_cycles = this._total_number_of_write_cycles + 1;
    }

    RegisterWrites(numberOfWrites){
        this._total_number_of_items_written = this._total_number_of_items_written + Number(numberOfWrites);
    }

    LogWriteReport() {
        let current_time = Date.now();

        if (current_time - this._last_avg_report_time < this._reportIntervalMs) {
            return;
        }

        // generate new report
        let average_write = this._total_number_of_items_written / ((current_time - this._start_time_ms) / 1000); // items/second
        let average_items_write = this._total_number_of_items_written / this._total_number_of_write_cycles;
        get_logger().info(`Total writes : ${this._total_number_of_items_written};
                                               Average items/second : ${average_write.toFixed(2)}
                                               Average items / write : ${average_items_write.toFixed(2)}`);

        this._last_avg_report_time = current_time;
    }
}


module.exports = WritePumpReporting;
